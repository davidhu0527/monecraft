# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A Minecraft-inspired voxel game: Next.js 16 (App Router, Turbopack), React 19, TypeScript (strict), Three.js, Bun. Single-player, browser-based, client-only, saves to localStorage.

## Commands

```bash
bun install        # Install dependencies
bun run dev        # Dev server at http://localhost:3000
bun run build      # Production build — part of the verification baseline
bun run lint       # ESLint (flat config, eslint .)
bun run typecheck  # tsc --noEmit
bun test           # Unit + integration + component tests
bun run test:e2e   # Playwright browser smoke tests (needs `bunx playwright install chromium` once)
```

## Development Workflow

For a non-trivial change:

- **Branch** for features and multi-file or dependency changes — a `<type>/<topic>` branch off `main` (e.g. `upgrade/next16-react19-three184`). Small doc-only or single-fix edits can go straight to `main`.
- **Commit in focused slices.** One logical change per commit (e.g. split a dead-code removal from the feature that replaces it), with imperative, scoped messages (e.g. `Add block breaking crack overlay`) — plain style, no Conventional-Commit prefixes, no attribution trailers. Keep `bun run lint` green at each commit so the branch stays bisectable.
- **Update docs in the same change.** When behavior or a documented concept changes, update CLAUDE.md / `docs/` and add a `CHANGELOG.md` entry. Flag any save-format or worldgen impact.
- **Verify before a PR:** `bun run lint`, `bun run typecheck`, `bun test`, and `bun run build` green; `bun run test:e2e` for changes touching the renderer, input, or React shell. A manual gameplay pass is only needed for pointer-lock handling or visual-appearance changes (see docs/testing.md).
- **Open the PR against this fork's `main`** (`gh pr create --repo hutusi/monecraft --base main`); do not add a "Generated with Claude Code" line to the description. Pushing and opening PRs are user-authorized — don't push or open a PR unless asked.

## Docs

- [docs/architecture.md](docs/architecture.md) — engine/renderer/shell layers, step order, engine invariants & gotchas
- [docs/adding-content.md](docs/adding-content.md) — step-by-step: new block / item / recipe / mob / mechanic
- [docs/save-format.md](docs/save-format.md) — save schema, autosave, compatibility rules
- [docs/testing.md](docs/testing.md) — test coverage map and the worldgen hash re-baseline policy
- `README.md` — player-facing controls and quick start
