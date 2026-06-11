# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Changed

- Upgraded dependencies: Next.js 14.2 → 16.2 (Turbopack), React 18.3 → 19.2, Three.js r168 → r184, TypeScript 5.6 → 6.0, ESLint 8 → 9 with flat config (`next lint` was removed upstream; `bun run lint` now runs `eslint .`)

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
