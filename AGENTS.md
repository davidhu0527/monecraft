# AGENTS.md

Guidance for AI coding agents (Codex, Claude Code, Cursor, …) working in this repository. This file is the single source of truth — CLAUDE.md imports it.

## Project

A Minecraft-inspired voxel game: Next.js 16 (App Router, Turbopack), React 19, TypeScript (strict), Three.js, Bun. Single-player, browser-based, client-only, saves to localStorage.

**Zero binary assets**: every asset is generated at runtime — textures and sprites from pixel code, sound and music synthesized via ZZFX/WebAudio. New content should follow this principle unless the user decides otherwise. The one sanctioned exception is the UI pixel font (Pixelify Sans), loaded via `next/font/google` and self-hosted at build in `app/fonts.ts` — don't "fix" it back to a system font.

## Commands

```bash
bun install        # Install dependencies
bun run dev        # Dev server at http://localhost:3000
bun run build      # Production build — part of the verification baseline
bun run lint       # ESLint (flat config, eslint .)
bun run typecheck  # next typegen + tsc --noEmit
bun run format     # Prettier --write (CI runs format:check — unformatted files fail the build)
bun test           # Unit + integration + component tests
bun run test:e2e   # Playwright browser smoke tests (needs `bunx playwright install chromium` once)
```

## Development Workflow

For a non-trivial change:

- **Branch** for features and multi-file or dependency changes — a `<type>/<topic>` branch off `main` (e.g. `upgrade/next16-react19-three184`). Small doc-only or single-fix edits can go straight to `main`.
- **Commit in focused slices.** One commit per logical slice (e.g. split a dead-code removal from the feature that replaces it). Keep `bun run lint` green at each commit so the branch stays bisectable. Use Conventional Commit messages; no `Co-Authored-By` trailers.
- **Explain the why in the commit body.** The subject says what changed; the body (separated by a blank line) explains why — the problem or motivation, and any non-obvious decision or trade-off. A body is required for anything beyond trivial edits (typos, formatting); `git log` should make sense without opening the PR.
- **Update docs in the same change.** When behavior or a documented concept changes, update AGENTS.md / `docs/` and add a `CHANGELOG.md` entry. Flag any save-format or worldgen impact.
- **Verify before a PR:** `bun run lint`, `bun run typecheck`, `bun run format:check`, `bun test`, and `bun run build` green (the same list CI's `verify` job runs); `bun run test:e2e` for changes touching the renderer, input, or React shell. A manual gameplay pass is only needed for pointer-lock handling or visual-appearance changes (see docs/testing.md).
- **Open the PR against this fork's `main`** (`gh pr create --repo hutusi/monecraft --base main`); do not add AI-attribution lines (e.g. "Generated with …") to the description. Pushing and opening PRs are user-authorized — don't push or open a PR unless asked.

## Docs

- [docs/architecture.md](docs/architecture.md) — engine/renderer/audio/shell layers, step order, engine invariants & gotchas
- [docs/adding-content.md](docs/adding-content.md) — step-by-step: new block / item / recipe / mob / mechanic
- [docs/save-format.md](docs/save-format.md) — save schema, autosave, compatibility rules
- [docs/testing.md](docs/testing.md) — test coverage map and the worldgen hash re-baseline policy
- [docs/tuning.md](docs/tuning.md) — gameplay tunables in `config.ts`, grouped by effect with balance trade-offs
- [docs/manual.md](docs/manual.md) — player guide (gameplay, survival, crafting, mobs, farming)
- [docs/reference.md](docs/reference.md) — gameplay reference tables (recipes, blocks, mobs, items)
- `README.md` — player-facing controls and quick start
