# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

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

### Fixed

- Crafting with a full inventory no longer consumes the cost while silently destroying the crafted result; the recipe is refused instead (the craft button was already disabled in this case, so this was only reachable programmatically)

- Upgraded dependencies: Next.js 14.2 → 16.2 (Turbopack), React 18.3 → 19.2, Three.js r168 → r184, TypeScript 5.6 → 6.0, ESLint 8 → 10 with flat config (`next lint` was removed upstream; `bun run lint` now runs `eslint .`)
- Replaced `eslint-config-next` (blocked on ESLint 10 by `eslint-plugin-react`) with a hand-rolled flat config: `@eslint/js`, `typescript-eslint`, `@eslint-react/eslint-plugin`, `eslint-plugin-react-hooks` v7, `@next/eslint-plugin-next`
- Removed dead code in world generation flagged by the new lint stack (`seededHash`, useless biome-height initializers)

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
