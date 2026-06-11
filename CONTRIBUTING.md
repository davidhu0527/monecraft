# Contributing

Monecraft is a Minecraft-inspired voxel game built with Next.js 16 (App Router), React 19, TypeScript (strict), Three.js, and Bun. It is single-player, browser-only, and saves to localStorage.

## Getting started

```bash
bun install
bun run dev     # http://localhost:3000
```

## Verification baseline

Every commit should keep all four of these green:

```bash
bun run lint        # ESLint (flat config)
bun run typecheck   # tsc --noEmit
bun test            # unit + characterization tests
bun run build       # production build
```

`bun run format` applies Prettier; CI enforces `format:check`. For anything touching the game engine, also do a manual gameplay pass (mine/place, craft, combat at night, die/respawn, save/load) — there is no automated end-to-end test.

## Workflow

- **Branch** off `main` as `<type>/<topic>` (e.g. `feature/fishing`, `fix/mob-knockback`) for features and multi-file changes. Small doc-only or single-fix edits can go straight to `main`.
- **Commit in focused slices** — one logical change per commit, imperative messages (`Add block breaking crack overlay`), no Conventional-Commit prefixes, no attribution trailers. Keep every commit green so the branch stays bisectable.
- **Update docs in the same change.** When behavior or a documented concept changes, update `docs/` and add a `CHANGELOG.md` entry.

## Save compatibility (read before touching worldgen)

Saves store only the world seed plus block-change deltas. World generation must therefore produce **byte-identical** output for a given seed, and the voxel index formula (`x + z*sizeX + y*sizeX*sizeZ`) must never change. The characterization tests in `lib/worldgen.test.ts` pin generator output with SHA-256 digests — if they fail after your change, your change breaks every existing save. Fix the code, never the hash. See `docs/save-format.md` and `docs/testing.md`.

## Docs

- `docs/architecture.md` — layers, game loop order, engine invariants
- `docs/adding-content.md` — how to add a block / item / recipe / mob
- `docs/save-format.md` — save schema and compatibility rules
- `docs/testing.md` — what is tested and the hash re-baseline policy
