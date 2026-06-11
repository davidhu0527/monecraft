# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A Minecraft-inspired voxel game: Next.js 14 (App Router), TypeScript (strict), Three.js, Bun. Single-player, browser-based, client-only, saves to localStorage.

## Commands

```bash
bun install     # Install dependencies
bun run dev     # Dev server at http://localhost:3000
bun run build   # Production build + type checking — run before committing; this is the verification baseline
bun run lint    # Next.js ESLint
```

No test suite. For gameplay changes, manually verify in the browser: movement/collisions, mining & placing, crafting/durability, save/load across a reload, mob behavior day vs night.

## Architecture map

- **UI** — `app/page.tsx` mounts `components/MinecraftGame.tsx` (canvas + HUD); HUD pieces in `components/game/`.
- **Engine** — `lib/game/useMinecraftGame.ts` owns the Three.js scene and the rAF loop, calling per-mechanic modules from `lib/game/runtime/` in a fixed per-frame order.
- **World** — `VoxelWorld` in `lib/world.ts`: flat `Uint8Array` voxels, procedural generation, region-based meshing, runtime canvas texture atlas.
- **Config** — `lib/game/config.ts` is the single source of truth for tunables (physics, hardness, `ITEM_DEFS`, `RECIPES`, `SAVE_KEY`).

Full detail (loop order, meshing, refs-vs-state bridge): [docs/architecture.md](docs/architecture.md).

## Hard rules

- New mechanics are a new module in `lib/game/runtime/` wired into the loop — never inline logic in the hook.
- Gameplay values live twice: React state (UI) and a ref (read by the loop). Keep both in sync via the existing `useEffect` pattern; updating only one is the classic bug.
- Saves are diffs against generated terrain: changing worldgen or the voxel index formula corrupts them — bump `SAVE_KEY` and note compatibility impact in PRs. See [docs/save-format.md](docs/save-format.md).
- Client-only: never touch `window`/`document`/localStorage at module top level — only behind `"use client"` inside effects.
- Before touching meshing, collision, or mob behavior, read the invariants in [docs/architecture.md](docs/architecture.md) (water rendering, unstuck rules, daylight thresholds, pointer lock).

## Conventions

- TypeScript strict; 2-space indentation; imports grouped by domain.
- `PascalCase` components/types, `camelCase` functions/variables, `UPPER_SNAKE_CASE` constants.
- Imperative, scoped commit messages (e.g. `Add block breaking crack overlay`); keep `bun run build` green at each commit.

## Docs

- [docs/architecture.md](docs/architecture.md) — layers, game loop order, refs-vs-state bridge, meshing, engine invariants & gotchas
- [docs/adding-content.md](docs/adding-content.md) — step-by-step: new block / item / recipe / mob
- [docs/save-format.md](docs/save-format.md) — save schema, autosave, compatibility rules
- `AGENTS.md` / `GEMINI.md` — sibling guidance for other agents; this file is canonical for Claude Code — keep them consistent when conventions change
- `README.md` — player-facing controls and quick start
