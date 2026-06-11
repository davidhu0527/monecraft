# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A Minecraft-inspired voxel game: Next.js 16 (App Router, Turbopack), React 19, TypeScript (strict), Three.js, Bun. Single-player, browser-based, client-only, saves to localStorage.

## Commands

```bash
bun install     # Install dependencies
bun run dev     # Dev server at http://localhost:3000
bun run build   # Production build + type checking — run before committing; this is the verification baseline
bun run lint    # ESLint (flat config, eslint .)
```

No test suite. For gameplay changes, manually verify in the browser: movement/collisions, mining & placing, crafting/durability, save/load across a reload, mob behavior day vs night.

## Architecture map

- **UI** — `app/page.tsx` mounts `components/MinecraftGame.tsx` (canvas + HUD); HUD pieces in `components/game/`.
- **Engine** — `lib/game/useMinecraftGame.ts` owns the Three.js scene and the rAF loop, calling per-mechanic modules from `lib/game/runtime/` in a fixed per-frame order.
- **World** — `VoxelWorld` in `lib/world.ts`: flat `Uint8Array` voxels, procedural generation, region-based meshing, runtime canvas texture atlas.
- **Config** — `lib/game/config.ts` is the single source of truth for tunables (physics, hardness, `ITEM_DEFS`, `RECIPES`, `SAVE_KEY`).

Full detail (loop order, meshing, refs-vs-state bridge): [docs/architecture.md](docs/architecture.md).

## Hard rules

- UI-facing gameplay values are mirrored as both React state and a ref (the loop reads the ref). Change them together via the existing `useEffect` sync — updating only one is the classic desync bug.
- Saves are diffs against generated terrain: changing worldgen or the voxel index formula corrupts existing saves — bump `SAVE_KEY` and note the impact in PRs. See [docs/save-format.md](docs/save-format.md).
- Client-only: no `window`/`document`/localStorage at module scope — access them inside effects/handlers (the game mounts behind `"use client"`).
- Meshing and collision carry non-obvious invariants that break silently (water renders double-sided/bidirectional; being in water is deliberately not "stuck"). Read [docs/architecture.md](docs/architecture.md) before changing them.

## Conventions

- TypeScript strict; 2-space indentation; imports grouped by domain.
- `PascalCase` components/types, `camelCase` functions/variables, `UPPER_SNAKE_CASE` constants.
- Prefer extracting per-mechanic logic into a `lib/game/runtime/` module over growing `useMinecraftGame.ts`.

## Development Workflow

For a non-trivial change:

- **Branch** for features and multi-file or dependency changes — a `<type>/<topic>` branch off `main` (e.g. `upgrade/next16-react19-three184`). Small doc-only or single-fix edits can go straight to `main`.
- **Commit in focused slices.** One logical change per commit (e.g. split a dead-code removal from the feature that replaces it), with imperative, scoped messages (e.g. `Add block breaking crack overlay`) — plain style, no Conventional-Commit prefixes, no attribution trailers. Keep `bun run build` green at each commit so the branch stays bisectable.
- **Update docs in the same change.** When behavior or a documented concept changes, update CLAUDE.md / `docs/` and add a `CHANGELOG.md` entry; keep `AGENTS.md` and `GEMINI.md` consistent. Flag any save-format or worldgen impact (see Hard rules).
- **Verify before a PR:** `bun run build` and `bun run lint` green, plus a manual gameplay pass for anything touching the engine (no automated test suite).
- **Open the PR against this fork's `main`** (`gh pr create --repo hutusi/monecraft --base main`); do not add a "Generated with Claude Code" line to the description. Pushing and opening PRs are user-authorized — don't push or open a PR unless asked.

## Docs

- [docs/architecture.md](docs/architecture.md) — layers, game loop order, refs-vs-state bridge, meshing, engine invariants & gotchas
- [docs/adding-content.md](docs/adding-content.md) — step-by-step: new block / item / recipe / mob
- [docs/save-format.md](docs/save-format.md) — save schema, autosave, compatibility rules
- `AGENTS.md` / `GEMINI.md` — sibling guidance for other agents; this file is canonical for Claude Code — keep them consistent when conventions change
- `README.md` — player-facing controls and quick start
