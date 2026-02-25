# Monecraft Project Overview

A playable Minecraft-inspired prototype built with **Next.js**, **TypeScript**, **Three.js**, and **Bun**. It features procedural voxel terrain, first-person movement, physics-based collisions, crafting, and a day/night cycle.

## Architecture

The project follows a layered architecture to separate UI, game engine, and world logic:

### 1. UI Layer (React/Next.js)
- **`app/page.tsx`**: The main entry point that renders the `MinecraftGame` component.
- **`components/MinecraftGame.tsx`**: Orchestrates the 3D canvas and 2D HUD components.
- **HUD Components**: `Hud.tsx`, `Hotbar.tsx`, `InventoryPanel.tsx`, and `RespawnOverlay.tsx` handle the game's user interface.

### 2. Game Engine (Core Loop)
- **`lib/game/useMinecraftGame.ts`**: The central hook that initializes the Three.js scene and manages the main game loop (`requestAnimationFrame`). It bridges React state (inventory, health) with imperative game logic.
- **Runtime Modules (`lib/game/runtime/`)**: Decoupled modules for specific game mechanics:
    - `playerMotion.ts`: Physics, movement, and collision detection.
    - `miningCombat.ts`: Logic for breaking/placing blocks and attacking mobs.
    - `dayNight.ts`: Environmental lighting and sky color cycles.
    - `mobs.ts`: Mob spawning and AI behavior.
    - `playerLife.ts`: Health, damage, and respawn logic.

### 3. World Layer
- **`lib/world.ts`**: Contains the `VoxelWorld` class which manages voxel data in a `Uint8Array`. It includes:
    - Procedural generation (biomes, caves, ores, structures).
    - Efficient geometry building for Three.js using a block atlas.
    - Raycasting and collision utilities.
- **`lib/game/config.ts`**: Centralized configuration for player stats, block properties, items, and crafting recipes.

## Development Commands

### Building and Running
- **Install dependencies**: `bun install`
- **Start development server**: `bun run dev` (Runs at `http://localhost:3000`)
- **Build for production**: `bun run build`
- **Linting**: `bun run lint`

## Development Conventions

- **State Management**: React state and refs are used to bridge the declarative UI with the imperative Three.js game loop.
- **Type Safety**: TypeScript is used throughout for strict typing of game entities, inventory items, and world data.
- **Performance**: Voxel data is stored in flat arrays (`Uint8Array`) for fast access and minimal memory overhead. Geometry is rebuilt in regions/chunks to optimize rendering.
- **Modularity**: New game mechanics should be added as separate modules in `lib/game/runtime/` and integrated into the main loop in `useMinecraftGame.ts`.
- **Assets**: Textures are generated on-the-fly via a canvas-based Block Atlas (`createBlockAtlasTexture` in `lib/world.ts`).

## Key Constants (`lib/game/config.ts`)
- `WORLD_SIZE_X`, `WORLD_SIZE_Y`, `WORLD_SIZE_Z`: 512x100x512.
- `RENDER_RADIUS`: Distance for rendering and geometry generation.
- `MAX_HEARTS`, `MAX_ENERGY`: Player vitals.
- `RECIPES`: Definition of all craftable items.
