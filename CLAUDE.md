# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A Minecraft-inspired voxel game built with Next.js 14 (App Router), TypeScript (strict), Three.js, and Bun. Single-player, browser-based, saves to localStorage.

## Commands

- `bun install` — install dependencies
- `bun run dev` — dev server at http://localhost:3000
- `bun run build` — production build + type checking (run this before committing; it is the baseline verification)
- `bun run lint` — Next.js ESLint

There is no test suite. For gameplay changes, manually verify movement, mining, crafting, save/load, and mob behavior in the browser.

## Architecture

Three layers: React UI → game engine hook → voxel world. React state/refs bridge the declarative UI with the imperative Three.js game loop.

### UI layer (`app/`, `components/`)
- `app/page.tsx` mounts `components/MinecraftGame.tsx`, which orchestrates the 3D canvas and 2D HUD.
- `components/game/` holds the HUD pieces: `Hud`, `Hotbar`, `InventoryPanel`, `RespawnOverlay`.
- Global styles are split across `app/base.css`, `app/hud.css`, `app/ui.css`.

### Game engine (`lib/game/`)
- `useMinecraftGame.ts` (~1100 lines) is the central hook: it initializes the Three.js scene, runs the `requestAnimationFrame` game loop, and wires React state (inventory, health) to imperative game logic. New mechanics get integrated into the loop here.
- `lib/game/runtime/` contains decoupled per-mechanic modules called from the loop: `playerMotion.ts` (physics/collision), `miningCombat.ts` (break/place blocks, attack mobs), `dayNight.ts` (lighting/sky cycle; hostile mobs behave differently by time of day), `mobs.ts` (spawning/AI), `playerLife.ts` (health/respawn), `input.ts`, `spawn.ts`, `persistence.ts`.
- `config.ts` is the single source of truth for tunables: player stats, world dimensions (512×100×512), block hardness, `ITEM_DEFS`, `RECIPES`, `RENDER_RADIUS`, `SAVE_KEY`.
- `types.ts` defines shared game entities; `save.ts` + `runtime/persistence.ts` handle localStorage save/load.

**Convention:** add new game mechanics as separate modules in `lib/game/runtime/` and integrate them into the loop in `useMinecraftGame.ts` — avoid growing the hook with inline logic.

### World layer (`lib/world.ts`)
- `VoxelWorld` class stores voxel data in a flat `Uint8Array` for fast access.
- Handles procedural generation (biomes, caves, ores, structures), raycasting, and collision queries.
- Geometry is built per region/chunk and rebuilt after block edits; textures are generated at runtime via a canvas-based block atlas (`createBlockAtlasTexture`).

## Conventions

- TypeScript strict; 2-space indentation; imports grouped by domain.
- `PascalCase` components/types, `camelCase` functions/variables, `UPPER_SNAKE_CASE` constants.
- Imperative, scoped commit messages (e.g. `Add block breaking crack overlay`).
- Changes to the save format or world generation affect backward compatibility — note this in PRs (the save key is versioned, currently `minecraft_save_v4`).

See `AGENTS.md` for fuller contribution guidelines.
