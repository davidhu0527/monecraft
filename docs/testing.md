# Testing

Two runners, three layers:

- **`bun test`** — unit, integration, and component tests, colocated as `*.test.ts[x]` next to the code they cover. The shared setup (`tests/setup.ts`, preloaded via `bunfig.toml`) registers happy-dom so React component tests run under the same runner; the game engine itself needs no DOM (see [architecture.md](architecture.md)).
- **`bun run test:e2e`** — Playwright browser smoke tests in `e2e/*.e2e.ts` against the production build. The file suffix matters: `bun test` auto-collects `*.test.ts` AND `*.spec.ts`, so E2E files must use `.e2e.ts`.

## What is covered

| Area                 | File                                            | What it pins down                                                                                                     |
| -------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Worldgen determinism | `lib/world/generation.test.ts`                  | SHA-256 digests of generated worlds per seed (the save-compat contract), plus structural probes and meshing snapshots |
| Voxel store          | `lib/world/voxelWorld.test.ts`                  | get/set/bounds/solidity and the voxel index formula saves depend on                                                   |
| Raycast & collision  | `lib/world/queries.test.ts`                     | DDA hit/previous cells, AABB collision edges, water non-solidity                                                      |
| Items & recipes      | `lib/game/config.test.ts`                       | Referential integrity: every recipe/drop/armor mapping points at a real item                                          |
| Inventory algebra    | `lib/game/inventory.test.ts`                    | Stack math, durability, crafting (including the refuse-on-full behavior), armor equip rules                           |
| Save format          | `lib/game/save.test.ts`                         | Round-trips, legacy-shape parsing, corrupt-data rejection                                                             |
| Simulation           | `lib/game/engine/GameEngine.test.ts`            | Headless gameplay: boot, movement, energy/regen, mining, commands, death/respawn, night spawning, save round-trips    |
| Renderer logic       | `lib/game/render/{mobVisuals,heldItem}.test.ts` | Model lifecycle (create/reuse/remove/dispose), positioning, bob, item swaps — pure Three.js, no DOM                   |
| Components           | `components/game/*.test.tsx`                    | InventoryPanel click-to-swap/equip/craft gating, Hotbar rendering and selection (happy-dom + Testing Library)         |
| Browser E2E          | `e2e/smoke.e2e.ts`                              | Real browser: boot without console errors, scene draws, input → movement, craft via UI, mining, save across reload    |

## Running the E2E suite

```bash
bunx playwright install chromium   # once
bun run test:e2e                   # builds and starts the prod server itself
```

E2E tests assert through `window.__monecraft` (the live engine/renderer/input handle — also handy in the browser console) instead of pixels; the one render check uses `renderer.renderedTriangles()`. The shared fixture fails any test that logs a console error.

**Known limitation:** headless Chromium cannot engage pointer lock (`requestPointerLock` never resolves). `acquirePointerLock` in `e2e/helpers.ts` tries the real thing, then falls back to forcing the input controller's lock flag — so key/mouse → engine wiring is still tested end to end, but real lock acquisition and look-around feel remain in the manual gameplay pass, along with visual quality. That manual pass is now only required for changes to pointer-lock handling or visual appearance.

## The worldgen hash policy

Saves store only the world seed plus block-change deltas, so `generateWorld` must produce byte-identical output for a given seed forever. The digests in `generation.test.ts` enforce that.

**If a hash test fails after your change, your change breaks every existing save. Fix the code, never the hash.**

Re-baselining the digests is legitimate in exactly two cases:

1. A **deliberate worldgen change** — flag it in the PR and CHANGELOG, and bump `SAVE_KEY` so old saves are discarded rather than corrupted.
2. A **Bun version bump** — the noise functions use `Math.sin`, whose exact results are engine-defined (ECMA-262 leaves transcendentals implementation-specific). CI pins `bun-version` in `.github/workflows/ci.yml` for this reason; bump both together and verify the digests merely shifted rather than the generation logic changing.

To regenerate digests: temporarily log the computed hash in the failing test, run `bun test`, and paste the new values in the same commit as the cause.

The same caveat means the hash tests prove _refactor purity on the pinned engine_, not cross-browser save portability — a player switching browsers may theoretically regenerate slightly different terrain for the same seed. That limitation predates the test suite; it is now at least documented.

## Writing new tests

- Pure logic (inventory, spawn rules, a new system): unit-test the module directly.
- Gameplay behavior: boot a small engine — `new GameEngine({ seed, rng, worldSize: { x: 64, y: 150, z: 64 } })` — and step it with synthetic `FrameInput`. Inject a seeded `rng` (see `mulberry32` in the engine tests) for determinism.
- The world boots at dawn with hostiles nearby; use the `calmDaytime` pattern from the engine tests when testing unrelated mechanics.
- A ray origin exactly on a voxel boundary may target a diagonal neighbor (DDA ambiguity) — center positions in cells when aiming at specific blocks.
