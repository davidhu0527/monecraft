# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.6.0] - 2026-06-13

### Added

- **Chests & persistent storage**: craft a chest (8 planks), place it, and right-click it to open a **27-slot** storage grid above your inventory — the long-standing "everything rides in 36 slots on your person" gap is closed
  - Introduces the game's first **block-entity** layer: a chest's contents live in `state.containers` (a `Map` keyed by the block's voxel index, the same space as the block diff). The right-click opens it via the existing interact precedence (after bed/furnace), and the same click-one-slot-then-another interaction now spans both grids through a new `moveStack` command (chest slots offset by `CONTAINER_SLOT_BASE`); pure cross-array `moveStack`/`tryInsertSlots` helpers join `lib/game/inventory.ts`
  - **Breaking a chest spills its contents** back into your inventory (tool/armor durability preserved) and returns the chest item; if there isn't room for everything the break is refused (a `breakBlocked` toast) so nothing is lost — consistent with the game's no-ground-item loot model
  - **Save format v4** (additive — `SAVE_KEY` unchanged, v1/v2/v3 saves still load): a new optional `blockEntities` field persists non-empty chests; `migrateSaveV3toV4` is a pure version bump and `readSave` chains v1→v2→v3→v4. **No worldgen impact** (chests are never generated). New `chest` block/item, an 8-planks recipe, a `CHEST_SLOTS` tunable, a generated chest atlas tile, and a synthesized open-creak sound
- **Juice & atmosphere pass**: the world now reacts and breathes, all via procedural rendering/audio (zero new assets) with **no save-format or worldgen impact**
  - **Particles**: a pure, unit-tested structure-of-arrays particle pool (`lib/game/render/particlePool.ts`) wrapped by a single `THREE.Points` draw call (`particleSystem.ts`) whose attributes refill each frame; a small shader draws each particle as a soft round sprite that fades over its life (no texture). The renderer gained `handleEvent(event, state)`, wired into the event drain beside `audio.handleEvent`: breaking a block throws shards tinted from `BLOCK_COLORS`, placing puffs, mob death bursts in the mob's body color, eating drops crumbs, and jumping/landing kick dust (landing scales with impact). Footstep dust spawns from a stride-distance accumulator. The three positioned events (`blockBroken`/`blockPlaced`/`mobDied`) gained additive `x,y,z` fields so bursts land correctly
  - **Night sky**: a deterministic 800-point star field that fades in at dusk, sprite discs for the moon and a now-visible sun riding opposite ends of the sun arc, and a drifting cloud sheet from a seamlessly tiling canvas-noise mask (`starField.ts`, `skyView.ts`). All camera-following and fog-exempt; opacities ramp off `daylight`
  - **Weather**: a pure, deterministic system (`engine/systems/weather.ts`) sets a **transient** `state.weather` (never serialized) — time splits into windows, a seeded hash decides precipitation, and biome picks snow (mountains) / clear (desert, ocean) / rain. It drives a camera-following precipitation field (`precipitation.ts`), an overcast sky tint + dimmed light + nearer fog in `syncDayNight`, and a synthesized looping rain bed on the audio graph (`rainLoop.ts`). Strictly cosmetic — spawn/daylight balance is untouched. New `WEATHER_CYCLE_SECONDS` / `WEATHER_RAIN_FRACTION` tunables
- **UI polish pass for a more authentic Minecraft look**: the interface now reads closer to real Minecraft across five fronts
  - **Pixel font**: UI text switches from the generic monospace stack to **Monocraft**, an open-source Minecraft-style face (SIL OFL 1.1) self-hosted via `next/font/local` from a committed woff2 in `app/fonts/` and exposed as the `--mc-font` CSS variable. Its coding ligatures are disabled so UI text stays literal. The monospace stack stays as the fallback and is pinned on the F3 debug readout, which relies on column alignment. This bundled font file is a deliberate, documented exception to the zero-binary-asset rule (the only one)
  - **Textured GUI chrome**: panels, inventory slots, recipe entries, and buttons gain a faint generated grain instead of flat fills. A new `grayGrainTileUrl` generator in `lib/ui/chromeTiles.ts` installs `--mc-tile-panel/well/button` as CSS variables (sunken bias on the slot well); the CSS layers each tile over the existing flat color, so bevels are untouched and SSR/pre-install falls back to the solid color
  - **Item tooltips**: hovering hotbar, inventory, and recipe entries now shows a cursor-following, near-black tooltip with a violet gradient border (new `useItemTooltip` hook in `components/game/ItemTooltip.tsx`) instead of the browser's native `title=`. Durable items show a gray "Durability x / y" line and locked recipes show "Requires <station>". The tooltip is `pointer-events:none` and `aria-hidden`, so it never blocks the pointer-lock click and accessible names (the `aria-label`s) are unchanged
  - **Depth**: a shared `.menu-backdrop` dims the frozen world behind the inventory and pause menu (the dimming moved off `.pause-overlay` so it no longer double-darkens), plus an always-on screen-edge `.vignette` over the 3D view (tunable via `--mc-vignette`)
  - **Motion**: a centered pop-in for the inventory panel, a fade-in for the pause overlay, quick hover/press feedback on slots and buttons, and a small rise on the hotbar item-name pop — all disabled under `prefers-reduced-motion`
  - No save-format or worldgen impact
- **Pickup & status toasts**: because mob loot drops straight into inventory storage (no ground item), kills could feel like they paid out nothing. A kill now shows a brief on-screen toast just above the hotbar (e.g. "+2 Wool, +1 Raw Mutton"). The same in-game toast also surfaces the sleep-denied messages ("You can only sleep at night" / "Monsters are nearby"), which previously only rendered inside the pause menu and so were invisible during play
- **Animal breeding**: right-click a sheep or horse with wheat (or a chicken with seeds) to put it "in love"; two in-love adults of the same kind standing close together spawn a baby that follows the parents, can't be farmed for drops, and grows to full size after ~90 seconds. This makes mob drops renewable, closing the loop back to combat loot. The passive population is capped (24) and feeding costs crops, so it stays bounded
  - New `MobState.fedTimer`/`ageTimer`, a `breeding` system ticked after mob AI, and a shared `findAimedMobIndex` so feeding and attacking use the same "what's in my crosshair" rule. Feeding joins the right-click precedence ahead of block interaction. New fed/bred sounds; babies render at 55% scale. Breeding state is session-only (mobs are never saved). No save-format or worldgen impact
- **Furnace & cooking**: craft a furnace (8 cobble) and right-click it to open the crafting panel in furnace mode, which unlocks smelting recipes — raw chicken or mutton + 1 planks (the fuel) cook into the cooked version, restoring 8 hunger versus 3 raw. Smelting recipes show as locked ("Requires Furnace") until a furnace is open
  - Reuses the Phase 2 interact system and the existing crafting panel — no separate furnace UI. Recipes gained an optional `station` field; the gate is enforced engine-side in the `craft` command (UI gating alone is spoofable). New `Furnace` block with a glowing-mouth atlas tile, `cooked_chicken`/`cooked_mutton` items, and a smelt sound. No save-format or worldgen impact
- **Farming & food**: craft a wood hoe (2 planks + 1 wood), right-click grass or dirt to till it into farmland, then right-click farmland with seeds to plant wheat. Crops grow through four stages over ~2.5 minutes and, when mature, harvest into wheat plus 1–2 seeds; an immature crop just returns its seed. Craft 3 wheat into bread (restores 6 hunger)
  - Seeds come from breaking grass (20% chance per block) — `addBlockDrop` now rolls a per-block `rollBlockDrops` table (`lib/game/items.ts`) instead of a single fixed drop
  - New **random-tick system** (`lib/game/engine/systems/randomTicks.ts`): each interval samples columns near the player and runs per-block handlers — the extensible basis for crop growth (and future saplings / grass spread). Crops are solid full-cube blocks (so they can be targeted and harvested) with each growth stage its own `BlockId`, which means they persist through the existing block-diff save with **no save-format change**
  - New `Farmland` + `WheatStage0..3` blocks, `wood_hoe`/`seeds`/`wheat`/`bread` items with generated sprites, and till/plant sounds. The right-click "use held item" step joins the interact precedence (after block interaction, before placement). No worldgen changes
- **Beds & sleeping**: craft a bed (3 wool + 3 planks), place it, and right-click it at night to skip to morning — the screen fades to black, the day clock jumps to a fresh dawn, and the bed becomes your respawn point (respawn falls back to a random land point if the bed is gone). Sleeping is refused during the day or with a hostile within 12 blocks, with an on-screen reason
  - New **right-click interact system** (`lib/game/engine/systems/interact.ts`): a fixed precedence in the `placeBlock` command runs block interaction before placement, so interactive blocks (beds now; furnaces later) take the click instead of getting a block placed on them. New `Bed` block + `bed` item, synthesized sleep/wake sounds, and a `SleepOverlay` fade component
  - **Save format v3** (additive — `SAVE_KEY` unchanged, v1/v2 saves still load): time of day (`dayClock`), `hearts`, `hunger`, and the bed `spawnPoint` now persist. Previously all four reset on reload, so sleeping through the night wouldn't have survived a reload. `readSave` chains the migrations v1 → v2 → v3
- **Mob loot & drops**: mobs now drop kind-specific items when they die instead of the old flat "cobble for hostiles, food for everything else" rule. Sheep drop wool + raw mutton, chickens feather + raw chicken, horses leather, zombies rotten flesh, skeletons bone, spiders string — counts are randomized per the engine's RNG (`lib/game/mobLoot.ts`). A new `mobDied` engine event plays a synthesized death thud
  - New items: `wool`, `feather`, `bone`, `leather`, `string` (crafting materials) and `rotten_flesh`, `raw_chicken`, `raw_mutton` (edible food), each with a generated 16×16 sprite (zero-asset)
  - **Per-food hunger**: food now restores a value carried on the item itself rather than one global constant. The generic `food` item still restores 7; raw meats restore 3, rotten flesh 2. New `food` and `material` item kinds; the legacy `food` item is reinterpreted (old saves load unchanged — saves store only item id + count)
  - New recipe: 4 string → 1 wool, so spider drops feed the wool supply (and, later, beds)
  - No save-format or worldgen impact
  - Selection recolors the body live (material color swap, no rebuild) and persists as a player preference under its own localStorage key (`minecraft_skin_v1`), separate from the world save — it survives world resets. No save-format or worldgen impact
- **Camera view toggle (V)**: cycles first-person → third-person rear → third-person front, like Minecraft's F5 (V instead, because F5 reloads the page in browsers)
  - New humanoid player body (head, torso, two arms, two legs) in the zero-asset box-mesh style, visible only in third person — walk gait scaled by speed, a chop animation on attacks and while mining, the look pitch on the head, and the held hotbar item rendered in the right hand via the shared item-model builder
  - The third-person camera boom raycasts against terrain and clamps so walls never occlude the player; the front view flips the heading and inverts the tilt while mouse control of the player stays unchanged
  - Gameplay is intentionally eye-relative in every mode (mining/placing reach, combat aim, audio panning are unaffected); the crosshair stays centered, matching Minecraft
  - The view mode is session-only (resets to first-person on reload). No save-format or worldgen impact

### Documentation

- **Added `docs/manual.md`**, a player-facing guide: getting started / your first day, the full control map, survival (health, hunger gates, combat, armor, death), the day-night thresholds, mining with tool-tier gating, crafting and smelting, the mob roster and breeding, farming, beds and sleeping, the procedural audio, and saving. Linked from the README and AGENTS.md
- **Added `docs/reference.md`**, scannable tables cross-checked against the code: all 31 recipes, the 26 block types (hardness + tool gate), the 6 mobs (stats + drop ranges), and item stats for tools, weapons, armor, and food
- **Added `docs/tuning.md`**, a contributor balance guide that groups the `config.ts` tunables by gameplay effect (player feel, survival pressure, danger, progression, farming/breeding, persistence/rendering), names the system that reads each, and flags the save-sensitive ones (`SAVE_KEY`, inventory layout)
- **Refreshed `docs/architecture.md`** to match the shipped engine: the per-frame step order now lists the random-tick (crop growth) and animal-breeding systems, the right-click precedence documents the full feed → interact → use-held → place chain, the mob/block drop tables (`rollMobDrops`/`rollBlockDrops`) are described, and the `window.__monecraft` debug handle the Playwright `e2e/` suite drives through is noted

## [0.5.0] - 2026-06-13

### Added

- **Animated first-person held item**: a one-shot swing on attack clicks (hit or miss, via a new `attackSwung` engine event), a looping swing while mining, a walk bob scaled by movement speed, an equip dip when switching slots, and a faint idle sway
- Held tools, weapons, and food are now built by extruding their 16×16 inventory sprites into pixel-thick voxel meshes (one geometry, vertex colors), so the in-hand model always matches the icon; held blocks remain cubes
- Redesigned knife sprite: a single-edged drop-point blade with a bright cutting edge, dark spine, and riveted handle — clearly distinct from the swords (no crossguard). No save-format or worldgen impact
- **Procedural audio** — the game has sound, with zero audio assets (everything is synthesized at runtime, like the sprite system):
  - Block interaction SFX by material (stone/wood/grass/sand/glass/water): break, place, and staged mining hit ticks
  - Player feedback: surface-aware footsteps, jump and impact-scaled landing, hurt, eating, death/respawn stingers
  - Mob sounds: idle calls (sheep, chicken, horse, zombie, skeleton, spider) with distance falloff and look-relative stereo pan inside a 24-block earshot, plus attack and melee-hit sounds
  - Generative background music: a pentatonic ambient pad that brightens and quickens by day, darkens at night, and shifts with the biome (5 s hysteresis at borders); ducks behind the pause menu
  - Pause-menu Sound section: master and music sliders plus mute, persisted under a separate localStorage key (`minecraft_audio_v1`)
  - One-shot SFX ride on new engine `GameEvent`s (block broken/placed, hurt, ate, jumped, landed, mob attacked/hit); continuous sound derives from state, mirroring the renderer
  - New dependency: [zzfx](https://github.com/KilledByAPixel/ZzFX) (~1 KB, MIT) for SFX synthesis; the AudioContext is created only on the first user gesture (autoplay policy)
  - No save-format or worldgen impact

## [0.4.0] - 2026-06-12

### Added

- Snow and Cactus blocks (mineable, placeable; cactus deals no contact damage). Snow caps mountain tops above y=68; cacti scatter across dry desert sand
- Sand beaches where low land meets the sea (shoreline band around sea level)

- **Minecraft-style UI overhaul**: pixel-art hotbar with white selection outline and fading item-name popup, heart/hunger/armor icon rows, survival-layout inventory (armor column, 9×3 storage grid, hotbar row) with a visual recipe book (ingredient icons → result), pause menu (Esc) with Save/Load/Reset and a controls reference, red-tinted "You Died!" death screen with a Respawn button, and a toggleable F3 debug overlay (position, daylight, mob counts, FPS)
- Procedural pixel-art sprite system (`lib/ui/`): 16×16 item icons (isometric block cubes from `BLOCK_COLORS`, shape×material-palette tools/weapons/armor), HUD icons (hearts, drumsticks, armor), and UI noise tiles — all generated in code, no image assets, covered by integrity tests
- Top-right minimap rendered from world block data (north-up, height-shaded, player arrow, refreshes on block edits)
- Engine commands: `pause`/`resume` (freezes the whole simulation behind the menu), `toggleDebug`, and `respawn` (skips the death countdown)

### Fixed

- On slow machines the simulation ran in slow motion: the frame loop clamped each frame to one 50 ms step, so at low FPS game time fell behind wall time. The loop now catches up with bounded substeps

### Changed

- **Fewer, better-spread animals**: the day-one passive population drops from 34 to 14 (6 sheep, 5 chickens, 3 horses) and scatters over a wider ring than hostiles, so the spawn area no longer feels crowded. Initial hostiles and night spawning are unchanged. Mobs and the respawn point also no longer place on flooded columns
- **Worldgen rebalanced — `SAVE_KEY` bumped to `minecraft_save_v5`, existing saves are discarded.** The biome noise field was degenerate (whole maps collapsed to 1–2 biomes; forests effectively never generated, leaving some worlds nearly woodless). Maps now contain coherent patches of all five biomes (forest ~19–31%, measured across seeds). Tree canopies no longer overwrite trunk tops (trees were losing 2 wood blocks each and looked like bushes), tree density roughly doubled, and forests grow taller trunks. Worldgen hash tests re-baselined per the documented policy
- **Stats rebalanced to Minecraft ranges** — health 50 → 20 (10 hearts), energy renamed to hunger and rescaled 100 → 20 (10 drumsticks) with total drain ranges preserved (sprint 100 blocks / walk 300 / 50 jumps per point), food restores 7; health regen now requires hunger ≥ 12 and sprinting needs hunger > 6; hunger refills on respawn; fall/void damage rescaled to the new HP range
- **Hostile mobs hit harder**: zombie/skeleton damage 1 → 3, spider 1 → 2 (the old values were ~2% of max HP per hit; this is a real difficulty increase)
- **Inventory shrunk to 36 slots (9-slot hotbar + 27 storage)** to match the Minecraft layout; the `Digit0` hotbar binding is gone (1–9 only)
- **Save format bumped to version 2** (same `SAVE_KEY`, no worldgen impact): v1 saves are migrated on load — slots are compacted 40 → 36 with stackables merged, `selectedSlot` clamped to 0–8; items that genuinely overflow the smaller inventory are dropped
- Save/Load/Reset buttons moved from the top-left HUD (now removed) into the pause menu; the old top-left info lives in the F3 overlay
- Escape now opens the pause menu (pointer-lock loss during gameplay pauses the game; Esc also closes the inventory)

## [0.3.0] - 2026-06-11

### Added

- Playwright E2E smoke suite (`bun run test:e2e`, also a CI job): boots the production build in headless Chromium and verifies rendering, input → movement, crafting via UI, mining, and save persistence through a `window.__monecraft` debug handle (also usable from the browser console)
- React component tests for InventoryPanel and Hotbar, and Three.js-only unit tests for mob visuals and the held item, all under `bun test` via a happy-dom preload
- Test suite (`bun test`): worldgen determinism hash tests (save-compat guard), meshing snapshots, raycast/collision/save round-trip/item-recipe integrity tests, pure inventory unit tests, and headless engine simulation tests (movement, energy, regen, mining, crafting, death/respawn, night spawning, save round-trips)
- Quality tooling: `bun run typecheck` (tsc), Prettier + `.editorconfig`, GitHub Actions CI (lint, typecheck, format, test, build on pinned Bun)
- WebGL failure handling: a fallback panel replaces a crash when the renderer cannot start
- `CONTRIBUTING.md`

### Changed

- **Engine rewrite**: gameplay simulation moved out of the 1,100-line React hook into a headless, framework-agnostic `GameEngine` (`lib/game/engine/`) with one system module per mechanic and a single `Command` entry point for all UI/input intents. Rendering is isolated in `GameRenderer` (`lib/game/render/`), DOM input in `lib/game/input/`, and the hook is now a thin shell using `useSyncExternalStore`. The mirrored refs-vs-state bridge and its ESLint rule disables are gone. No save-format or worldgen impact — verified by hash tests and save round-trip tests.
- Split `lib/world.ts` into `lib/world/` modules (blocks, voxelWorld, generation, meshing, atlas, queries) behind an index barrel; worldgen constants named in a frozen `GEN` object. No save-format or worldgen impact — output verified byte-identical by hash tests.
- Split `lib/game/config.ts` into `config.ts` (named tunables), `items.ts`, and `recipes.ts`; inventory slot math extracted to pure `lib/game/inventory.ts`
- Held-item block palette moved next to the atlas palette in `lib/world/blocks.ts` (same values)
- Per-frame `Vector3` allocations in mob AI, combat, and player motion replaced with module-scope scratch vectors
- Upgraded dependencies: Next.js 14.2 → 16.2 (Turbopack), React 18.3 → 19.2, Three.js r168 → r184, TypeScript 5.6 → 6.0, ESLint 8 → 10 with flat config (`next lint` was removed upstream; `bun run lint` now runs `eslint .`)
- Replaced `eslint-config-next` (blocked on ESLint 10 by `eslint-plugin-react`) with a hand-rolled flat config: `@eslint/js`, `typescript-eslint`, `@eslint-react/eslint-plugin`, `eslint-plugin-react-hooks` v7, `@next/eslint-plugin-next`
- Removed dead code in world generation flagged by the new lint stack (`seededHash`, useless biome-height initializers)

### Fixed

- Unhandled `requestPointerLock()` rejection (surfaced by the E2E suite): clicking any UI button triggered a lock attempt whose failure logged an uncaught error in some environments; the game now stays unlocked silently
- Crafting with a full inventory no longer consumes the cost while silently destroying the crafted result; the recipe is refused instead (the craft button was already disabled in this case, so this was only reachable programmatically)

## [0.2.0] - 2026-06-11

### Added

- Survival systems: health regen, energy bar with distance/jump-based drain, food mechanics, hotbar hearts and health progress bar
- Day-night cycle with hostile mob behavior — night spawning, twilight-only spider aggression, daylight burn for zombies/skeletons
- Durability system for tools, weapons, and armor, persisted in saves
- Equipped armor slots with damage reduction
- Ore/gear progression: gold, sliver, ruby, sapphire, and diamond tiers with crafting recipes
- Biome-based terrain (oceans, forests, deserts, mountains) with caves, chambers, and tuned ore distribution
- Block breaking crack overlay (8-stage, hardness-scaled)
- Save system with block-diff persistence, autosave, and Reset World button
- Inventory expansion: 99-stack system, hotbar slot swapping, held item view, scrollable crafting list
- Emergency unstuck (auto safeguard + `U` key)
- Shared 16×16 per-face block texture atlas with multi-layer terrain shading and ambient occlusion

### Changed

- World deepened to 150 blocks with wider cave generation
- Water rendered from both sides; players can stay submerged without unstuck teleport
- Game runtime refactored into modular systems (`lib/game/runtime/`) with split UI/styles
- Smooth terrain noise (fixes tall column artifacts); Plains-biome spawn priority
- Mob combat tightened: no hitting through blocks, vertical melee reach check, knockback

### Fixed

- Map persistence and player-stuck bugs (collision depenetration, load-time relocation safety)
- Startup freeze from world generation load
- Dark block undersides via brighter tiles and bounce lighting

## [0.1.0]

Initial Minecraft-like prototype: procedural voxel terrain, first-person movement with gravity and collisions, block breaking/placing, hotbar, and basic mobs. Built with Next.js, TypeScript, Three.js, and Bun.
