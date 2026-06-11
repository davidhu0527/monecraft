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
```

The engine has **no React, no DOM, no rendering** — it runs (and is tested) headlessly in `bun test`. The renderer and the input controller are the only modules touching Three.js scene objects and DOM listeners respectively.

## React shell (`lib/game/useMinecraftGame.ts`, `components/`)

- `useMinecraftGame` creates the `GameEngine` in the canvas mount's callback ref, then an effect builds the `GameRenderer` and `inputController` and drives the `requestAnimationFrame` loop: `engine.step(dt, input)` → drain engine events → `renderer.sync(state)` → `renderer.render()`.
- UI state arrives as immutable `GameSnapshot`s via `useSyncExternalStore`; the engine replaces the snapshot object only when a visible value changes, so React re-renders are minimal and identity-driven.
- UI intents (`craft`, `swapSlots`, `selectSlot`, …) are dispatched as engine `Command`s. The only React state in the shell is pure UI concern: pointer lock, transient save messages, renderer failure.
- WebGL init failure is surfaced as `rendererError` and rendered as a fallback panel instead of crashing.
- Note for the React Compiler lint rules: consume the hook with destructuring (`const { … } = useMinecraftGame()`); property access on the result object can false-positive `react-hooks/refs`.

## Game engine (`lib/game/engine/`)

- `GameEngine.ts` — owns `GameState`, processes `dispatch(Command)`, advances `step(dt, input)`, serializes saves, and publishes snapshots (`subscribe`/`getSnapshot`). Randomness is injectable (`rng`) and the world size is overridable for fast headless tests.
- `state.ts` — `GameState` (player with `yaw`/`pitch`, inventory, mobs as **logical entities with no Three.js objects**, day clock, mining progress, timers) plus `FrameInput`, `GameSnapshot`, `GameEvent`.
- `commands.ts` — the `Command` union: every UI/input mutation enters the simulation through exactly this door.
- `blockChanges.ts` — the delta tracker behind the save format: tracked block writes against the worldgen baseline; reverted edits drop out of the save.
- `systems/` — one module per mechanic, each a function over `GameState`:

### Per-frame step order (in `GameEngine.step`)

1. Stuck detection / auto-unstuck (`STUCK_RESET_SECONDS`)
2. Death check + respawn countdown (while dead, only mobs tick)
3. Player movement & physics (`systems/playerMotion.ts` — derives direction from `yaw`, scratch vectors, no per-frame allocations)
4. Energy drain from sprint/walk/jump budgets + health regen (`systems/playerStats.ts`)
5. Mining progress and block breaking (`systems/mining.ts`; placement also lives here)
6. Day-night clock (`systems/dayNight.ts` — `daylightAt()` is the single daylight formula)
7. Night hostile spawning (`systems/spawnDirector.ts`, interval/cap in config)
8. Mob AI: wander/aggro/flee, attacks with line-of-sight, daylight burn (`systems/mobAI.ts`)

Combat (`systems/combat.ts`) runs on the `attack` command rather than per frame. New mechanics get a new system module and a slot in this sequence — don't grow the engine class with inline logic.

## Renderer (`lib/game/render/`)

- `GameRenderer.ts` — scene/camera/WebGL/lighting; `sync(state)` maps simulation state to visuals each frame; `dispose()` frees every GPU resource. WebGL creation returns `{ ok: false, error }` instead of throwing.
- **World mesh**: one mesh covers the visible region (not chunked), rebuilt when the player crosses a `RENDER_GRID` (20-block) boundary or when the engine sets `state.worldMeshDirty` (block edits, respawn, unstuck). Old geometry is disposed on rebuild.
- `mobVisuals.ts` — mob id → model map; creates/removes models as mobs spawn/die and animates bob + leg gait from mob state (the simulation knows nothing about legs).
- `heldItem.ts` / `crackOverlay.ts` — first-person item model and the 8-stage mining crack box (stage = progress / hardness).

## Input (`lib/game/input/inputController.ts`)

Owns every DOM listener. Continuous input (movement keys, mouse button, pointer lock, CapsLock) is exposed as a `FrameInput` the engine reads each step; discrete actions (hotbar, inventory toggle, place, eat, attack, unstuck) become commands; mouse-look calls `engine.applyLook`. The first click only acquires pointer lock; `KeyI` exits it.

## Inventory and items (`lib/game/`)

- `inventory.ts` — pure slot algebra (`adjustSlotCount`, `craft`, durability, armor); every function returns a new array or `null` for "no change". Crafting refuses when the result doesn't fit rather than destroying overflow.
- `items.ts` — `ITEM_DEFS`, `BLOCK_TO_SLOT`, `BREAK_HARDNESS`, armor slots, slot factories. `recipes.ts` — `RECIPES`.
- `config.ts` — every gameplay tunable, named: physics, energy rules, daylight thresholds, mob director, mining reach, autosave interval, `SAVE_KEY`.
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
