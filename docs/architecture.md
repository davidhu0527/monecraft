# Architecture

Three layers with hard boundaries:

```
React UI (components/)          declarative HUD/panels; reads snapshots, sends commands
    │  useSyncExternalStore + engine commands
GameEngine (lib/game/engine/)   headless simulation: all game state, stepped per frame
    │  reads/writes
Voxel world (lib/world/)        data + generation + meshing + queries
    ▲  read every frame by
GameRenderer (lib/game/render/) Three.js: maps simulation state → GPU objects
AudioDirector (lib/game/audio/)  WebAudio: maps engine events + state → procedural sound
```

The engine has **no React, no DOM, no rendering** — it runs (and is tested) headlessly in `bun test`. The renderer, the audio director, and the input controller are the only modules touching Three.js scene objects, the `AudioContext`, and DOM listeners respectively.

## React shell (`lib/game/useMinecraftGame.ts`, `components/`)

- `useMinecraftGame` creates the `GameEngine` in the canvas mount's callback ref, then an effect builds the `GameRenderer`, the `AudioDirector`, and `inputController` and drives the `requestAnimationFrame` loop: `engine.step(dt, input)` (in bounded catch-up substeps of ≤50 ms, so slow frames — e.g. software GL — don't run the simulation in slow motion) → drain engine events (death/respawn handling, `attackSwung` → `renderer.triggerSwing()`, + `audio.handleEvent`) → `minimap.sync(state)` → `renderer.sync(state)` → `audio.sync(state, dt)` → `renderer.render()`. The minimap must sync **before** the renderer because it reads `state.worldMeshDirty`, which `renderer.sync` clears.
- UI state arrives as immutable `GameSnapshot`s via `useSyncExternalStore`; the engine replaces the snapshot object only when a visible value changes, so React re-renders are minimal and identity-driven.
- UI intents (`craft`, `swapSlots`, `selectSlot`, …) are dispatched as engine `Command`s. The only React state in the shell is pure UI concern: pointer lock, transient save messages, renderer failure.
- WebGL init failure is surfaced as `rendererError` and rendered as a fallback panel instead of crashing.
- On mount the shell installs a `window.__monecraft` debug handle (`{ engine, renderer, input, audio }`) and deletes it on unmount. The Playwright suite in `e2e/` drives the game through this handle — asserting on engine state and `renderer.renderedTriangles()` rather than pixels (see [testing.md](testing.md)); it's also handy from the browser console.
- UI pixel art is procedural: `lib/ui/` generates 16×16 item/HUD sprites as pure pixel buffers (`spritePixels.ts`, `hudPixels.ts` — DOM-free, unit-tested) wrapped by a cached canvas→data-URL layer (`sprites.ts`, falls back to a transparent pixel under happy-dom) plus noise tiles installed as CSS vars (`chromeTiles.ts`). No image assets, no licensing exposure. `lib/ui/` must not import Three.js or the engine.
- Note for the React Compiler lint rules: consume the hook with destructuring (`const { … } = useMinecraftGame()`); property access on the result object can false-positive `react-hooks/refs`.

## Game engine (`lib/game/engine/`)

- `GameEngine.ts` — owns `GameState`, processes `dispatch(Command)`, advances `step(dt, input)`, serializes saves, and publishes snapshots (`subscribe`/`getSnapshot`). Randomness is injectable (`rng`) and the world size is overridable for fast headless tests.
- `state.ts` — `GameState` (player with `yaw`/`pitch`, inventory, mobs as **logical entities with no Three.js objects**, day clock, mining progress, timers) plus `FrameInput`, `GameSnapshot`, `GameEvent`.
- `commands.ts` — the `Command` union: every UI/input mutation enters the simulation through exactly this door.
- `blockChanges.ts` — the delta tracker behind the save format: tracked block writes against the worldgen baseline; reverted edits drop out of the save.
- `systems/` — one module per mechanic, each a function over `GameState`:

### Per-frame step order (in `GameEngine.step`)

0. Pause gate: while `state.paused`, `step` refreshes the snapshot and returns — mobs, the day clock, mining, and stats all freeze (autosave still serializes fine)
1. Stuck detection / auto-unstuck (`STUCK_RESET_SECONDS`)
2. Death check + respawn countdown (while dead, only mobs tick)
3. Sleep gate: while `state.sleepTimer > 0`, `step` decrements the fade and returns (full freeze, like pause); at zero it skips the clock to the next morning
4. Player movement & physics (`systems/playerMotion.ts` — derives direction from `yaw`, scratch vectors, no per-frame allocations)
5. Hunger drain from sprint/walk/jump budgets + health regen (`systems/playerStats.ts`)
6. Mining progress and block breaking (`systems/mining.ts`; placement also lives here)
7. Day-night clock (`systems/dayNight.ts` — `daylightAt()` is the single daylight formula)
8. Random block ticks (`systems/randomTicks.ts` — each interval samples columns near the player and runs per-block handlers; drives crop growth and is the extension point for future saplings / grass spread)
9. Night hostile spawning (`systems/spawnDirector.ts`, interval/cap in config)
10. Mob AI: wander/aggro/flee, attacks with line-of-sight, daylight burn (`systems/mobAI.ts`)
11. Animal breeding (`systems/breeding.ts` — feed-to-love timers, baby maturity, pairing in-love adults within range; the passive cap bounds the population)

Combat (`systems/combat.ts`) runs on the `attack` command rather than per frame. The `placeBlock` command runs a fixed right-click precedence (`systems/interact.ts`) — feed an aimed animal (`tryFeedAimedMob`) → interact with the aimed block (`tryInteractBlock`, e.g. sleep in a bed, open a furnace) → use the held item (`tryUseHeldItem`, e.g. a hoe tills soil, seeds plant a crop) → `placeSelectedBlock` — so each interaction consumes the click instead of getting a block placed against it. New mechanics get a new system module and a slot in this sequence — don't grow the engine class with inline logic.

## Renderer (`lib/game/render/`)

- `GameRenderer.ts` — scene/camera/WebGL/lighting; `sync(state)` maps simulation state to visuals each frame; `dispose()` frees every GPU resource. WebGL creation returns `{ ok: false, error }` instead of throwing.
- **Camera modes**: `state.cameraMode` (session-only, V key) selects first-person or a third-person rear/front boom. Pose math is pure (`cameraView.ts`); the boom is clamped each frame by a `voxelRaycast` from the eye so walls never occlude the player. Gameplay stays eye-relative in every mode — mining/combat raycasts and audio panning read player yaw/pitch, never the camera.
- **World mesh**: one mesh covers the visible region (not chunked), rebuilt when the player crosses a `RENDER_GRID` (20-block) boundary or when the engine sets `state.worldMeshDirty` (block edits, respawn, unstuck). Old geometry is disposed on rebuild.
- `mobVisuals.ts` — mob id → model map; creates/removes models as mobs spawn/die and animates bob + leg gait from mob state (the simulation knows nothing about legs).
- `heldItem.ts` / `crackOverlay.ts` — first-person item model and the 8-stage mining crack box (stage = progress / hardness). Held blocks stay cubes; everything else is the item's 16×16 inventory sprite extruded into a pixel-thick voxel mesh (`extrudedSprite.ts`, vertex colors, silhouette-only side faces) — the render layer imports `lib/ui/spritePixels` for this, which is legal because spritePixels is pure pixel-buffer code with no DOM. The holder group is posed every frame by `heldItemPose.ts` (pure math): a one-shot swing on the `attackSwung` event (the shell calls `renderer.triggerSwing()` from the event drain), a looping swing while mining, a walk bob scaled by horizontal speed, an equip dip on slot switch, and a faint idle sway.
- `playerModel.ts` / `playerPose.ts` / `playerVisuals.ts` — the player's own humanoid body, visible only in third person: box meshes with pivot groups at the joints, walk gait + attack/mining chop from pure pose math (mirroring `heldItemPose.ts`), the look pitch applied to the head only, and the held hotbar item in the right hand via the shared `itemModel.ts` builder (also used by `heldItem.ts`).
- **Skins**: the body is colored by a `PlayerPalette` from `lib/game/playerSkins.ts` (six presets); `GameRenderer.setPlayerSkin(palette)` recolors the named materials in place. The choice persists under its own localStorage key (`lib/game/skinSettings.ts`, `minecraft_skin_v1`) — a player preference like audio volumes, never part of the world save — and the pause-menu picker's bust portraits (`lib/ui/skinPortrait.ts`) derive from the same palettes.
- `minimap.ts` / `minimapColors.ts` — the top-right minimap: pure column sampling (top non-air block, height-shaded `BLOCK_COLORS`) feeding a 2D canvas that rebuilds its 128×128 base only when the player crosses a 16-block grid boundary or `worldMeshDirty` is set (read-only — the renderer owns clearing it), then blits with a yaw-rotated player arrow at ~10 Hz.

## Audio (`lib/game/audio/`)

All sound is procedural — no audio files, mirroring the sprite system. SFX are synthesized by [ZZFX](https://github.com/KilledByAPixel/ZzFX) parameter arrays; music is a generative ambient pad over raw WebAudio nodes.

- `audioDirector.ts` — the shell-side observer, exactly parallel to the renderer: `handleEvent(GameEvent)` plays one-shots (block break/place by material, hurt/eat/jump/land, mob attacks, death/respawn stingers) and `sync(state, dt)` drives everything continuous (footsteps, mining hit ticks, mob ambience, music mood). Music follows `state.daylight` immediately and the biome with 5 s hysteresis, and ducks while paused. The engine never imports this module.
- `synth.ts` — `SynthBackend`, **the only seam that touches WebAudio for SFX**: renders each `SoundDef` to an `AudioBuffer` once via `ZZFX.buildSamples` and plays it through gain/pan nodes with playback-rate jitter, a 10-voice cap, and per-sound retrigger throttling (which also de-dupes catch-up substep event bursts). Tests inject a recording fake instead.
- `soundParams.ts` / `materials.ts` — pure data: ZZFX parameter tables per `MaterialGroup`/`MobKind` (tune by ear in the [ZZFX designer](https://killedbyapixel.github.io/ZzFX/)) and the exhaustive `BlockId → MaterialGroup` mapping.
- `footsteps.ts` / `mobAmbience.ts` / `musicBrain.ts` — pure schedulers/composer (distance-accumulator strides, per-mob randomized call timers with distance gain + look-relative stereo pan, pentatonic random-walk note generation). `musicPlayer.ts` renders notes as detuned pad voices through a lowpass and a procedural convolution reverb.
- **Lazy unlock invariant**: no `AudioContext` exists until the first user gesture calls `unlock()` — including the `zzfx` import itself, which instantiates one at module scope and is therefore only ever imported dynamically inside `unlock()`. This satisfies the browser autoplay policy, keeps SSR/`bun test` import-safe, and keeps the console clean for the E2E fixture.
- Volume settings (`settings.ts`) persist under their own localStorage key (`minecraft_audio_v1`) — never part of the world save.

## Input (`lib/game/input/inputController.ts`)

Owns every DOM listener. Continuous input (movement keys, mouse button, pointer lock, CapsLock) is exposed as a `FrameInput` the engine reads each step; discrete actions (hotbar, inventory toggle, place, eat, attack, unstuck, pause, F3 debug, V camera view) become commands; mouse-look calls `engine.applyLook`. The first click only acquires pointer lock; `KeyI` exits it.

**Pause ↔ pointer lock**: the browser consumes Escape to exit pointer lock, so Esc never reaches keydown while locked — losing the lock during plain gameplay is the pause trigger (`pointerlockchange` dispatches `pause`). The inventory (`KeyI`) and death paths set their state flags _before_ the async `pointerlockchange` fires, and the engine's `pause` command additionally ignores those states, so they don't open the menu. While unlocked, Escape toggles pause directly (and closes the inventory). "Back to Game" resumes and re-requests the lock; Chrome's ~1.25 s cooldown after Esc can reject that request — the rejection is swallowed and the player just clicks the canvas.

## Inventory and items (`lib/game/`)

- `inventory.ts` — pure slot algebra (`adjustSlotCount`, `craft`, durability, armor); every function returns a new array or `null` for "no change". Crafting refuses when the result doesn't fit rather than destroying overflow.
- `items.ts` — `ITEM_DEFS`, `BLOCK_TO_SLOT`, `BREAK_HARDNESS`, armor slots, slot factories. `recipes.ts` — `RECIPES` (each with an optional `station`, e.g. `"furnace"` for smelting).
- Drop tables: `mobLoot.ts` (`rollMobDrops` — per-`MobKind` loot) and `items.ts` (`rollBlockDrops` — block drops, e.g. grass→occasional seed, mature wheat→wheat + 1–2 seeds). Both take an injectable `rng`, so tests get deterministic counts.
- `config.ts` — every gameplay tunable, named: physics, hunger rules, daylight thresholds, mob director, mining reach, autosave interval, `SAVE_KEY`.
- `save.ts` — versioned (de)serialization with an injectable `Storage`; `spawn.ts` — deterministic spawn search + random land points.

## World layer (`lib/world/`)

One module per concern, behind an `index.ts` barrel — consumers always import from `@/lib/world`:

- `blocks.ts` — `BlockId`, `BiomeId`, `WORLD_SIZE_*`, and both block palettes (`BLOCK_COLORS` paints the atlas; `HELD_BLOCK_COLORS` tints the held-item model — intentionally different values).
- `voxelWorld.ts` — `VoxelWorld` stores voxels in a flat `Uint8Array` (index = `x + z*sizeX + y*sizeX*sizeZ`) plus cheap queries (`get`/`set`/`isSolid`/`highestSolidY`/`getBiome`).
- `generation.ts` — `generateWorld(world)`: deterministic terrain, caves, water, ores, trees, houses. Constants live in the frozen `GEN` object. **Byte-identical output per seed is a save-format contract**, pinned by `generation.test.ts` hash tests — fix code, never hashes.
- `meshing.ts` — `buildGeometryRegion(world, …)` with face culling, baked ambient occlusion, and atlas UVs.
- `atlas.ts` — runtime canvas block atlas (`createBlockAtlasTexture`); tiles are generated from `BLOCK_COLORS`, no image assets. The only world module that touches the DOM.
- `queries.ts` — `voxelRaycast` (DDA), `collidesAt`, `hasSupportUnderPlayer`.

## Engine invariants & gotchas

Hard-won invariants — easy to silently break:

- **Water is special in meshing**: it's the only block whose faces render even against a same-type neighbor in `buildGeometryRegion`, and the single world material is `THREE.DoubleSide` so water is visible from inside. There is one material for all blocks — per-block render settings require restructuring. New transparent blocks must extend this face logic.
- **Being in water is not "stuck"**: the unstuck teleport fires only on solid-block overlap or falling below the world (y < 2). Don't make water count as a collision in `collidesAt` — players are allowed to stay submerged.
- **Daylight thresholds** (daylight ranges 0.04–1.0, named in `config.ts`): hostiles night-spawn below 0.28; spiders are hostile only below 0.42 (passive in twilight); zombies/skeletons burn above 0.72. The game boots at dawn (~0.05), so initial hostiles aggro immediately — headless tests use a `calmDaytime` helper.
- **DDA boundary ambiguity**: a raycast origin exactly on a cell boundary (integer coordinate) may target a diagonal neighbor — relevant for tests that aim at specific blocks.
- **Pointer lock**: the first left-click only acquires pointer lock (no mining); `KeyI` explicitly exits lock; right-click places without requiring lock.
- **Client-only**: never touch `window`/`document`/localStorage at module top level — everything runs behind `"use client"` and mounts via the callback ref/effect. The engine itself must stay DOM-free so it keeps running under `bun test`.
