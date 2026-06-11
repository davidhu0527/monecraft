# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

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
