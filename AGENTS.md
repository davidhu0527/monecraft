# Repository Guidelines

## Project Structure & Module Organization
This is a Next.js + TypeScript Minecraft-like game.

- `app/`: App Router entrypoints and global styles.
  - `app/layout.tsx`: Root layout and CSS imports.
  - `app/page.tsx`: Home page mounting the game.
  - `app/base.css`, `app/hud.css`, `app/ui.css`: Split global UI styles.
- `components/`: React UI and game container.
  - `components/MinecraftGame.tsx`: Main runtime/game orchestration.
  - `components/game/`: Modular UI pieces (`Hud`, `Hotbar`, `InventoryPanel`, `RespawnOverlay`).
- `lib/`: Core engine and domain logic.
  - `lib/world.ts`: Voxel world data, generation, caves/ores, meshing.
  - `lib/game/`: Shared config, types, save helpers, mob model/template logic.

## Build, Test, and Development Commands
- `bun install`: Install dependencies.
- `bun run dev`: Start local dev server (`http://localhost:3000`).
- `bun run build`: Production build + type checking.
- `bun run start`: Serve the production build.
- `bun run lint`: Run ESLint across the repo (`eslint .` with the flat config in `eslint.config.mjs`).

## Coding Style & Naming Conventions
- Language: TypeScript (`strict` enabled).
- Indentation: 2 spaces; keep code and imports grouped by domain.
- Components/types: `PascalCase` (`MinecraftGame`, `InventorySlot`).
- Variables/functions: `camelCase` (`spawnMob`, `buildGeometryRegion`).
- Constants: `UPPER_SNAKE_CASE` (`MAX_HEARTS`, `SAVE_KEY`).
- Prefer small modules in `lib/game/` over adding large inline blocks.

## Testing Guidelines
There is no formal test suite yet. Use build verification as the baseline:
- Run `bun run build` before committing.
- For gameplay changes, manually verify: movement, mining, crafting, save/load, mob behavior.

If adding tests, place them near related modules (e.g., `lib/game/*.test.ts`) and keep names behavior-oriented.

## Commit & Pull Request Guidelines
- Use imperative, scoped commit messages, e.g.:
  - `Add save system and cave ore progression with sliver/ruby`
  - `Refactor game into modular systems and split UI/styles`
- PRs should include:
  - What changed and why.
  - Manual test steps and results.
  - Screenshots/video for UI/gameplay changes.
  - Notes on save format/world-gen changes (backward compatibility impact).
