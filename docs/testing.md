# Testing

Two runners, three layers:

- **`bun test`** — unit, integration, and component tests, colocated as `*.test.ts[x]` next to the code they cover. The shared setup (`tests/setup.ts`, preloaded via `bunfig.toml`) registers happy-dom so React component tests run under the same runner; the game engine itself needs no DOM (see [architecture.md](architecture.md)).
- **`bun run test:e2e`** — Playwright browser smoke tests in `e2e/*.e2e.ts` against the production build. The file suffix matters: `bun test` auto-collects `*.test.ts` AND `*.spec.ts`, so E2E files must use `.e2e.ts`.

## What is covered

| Area                 | File                                                                                                                                  | What it pins down                                                                                                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worldgen determinism | `lib/world/generation.test.ts`                                                                                                        | SHA-256 digests of generated worlds per seed (the save-compat contract), plus structural probes and meshing snapshots                                                                                                                                                                                       |
| Voxel store          | `lib/world/voxelWorld.test.ts`                                                                                                        | get/set/bounds/solidity and the voxel index formula saves depend on                                                                                                                                                                                                                                         |
| Raycast & collision  | `lib/world/queries.test.ts`                                                                                                           | DDA hit/previous cells and hit distance, AABB collision edges, water non-solidity                                                                                                                                                                                                                           |
| Items & recipes      | `lib/game/config.test.ts`                                                                                                             | Referential integrity: every recipe/drop/armor mapping points at a real item                                                                                                                                                                                                                                |
| Inventory algebra    | `lib/game/inventory.test.ts`                                                                                                          | Stack math, durability, crafting (including the refuse-on-full behavior), armor equip rules                                                                                                                                                                                                                 |
| Save format          | `lib/game/save.test.ts`                                                                                                               | Round-trips, legacy-shape parsing, corrupt-data rejection                                                                                                                                                                                                                                                   |
| Simulation           | `lib/game/engine/GameEngine.test.ts`                                                                                                  | Headless gameplay: boot, movement, hunger/regen gates, mining, commands (incl. pause/debug/camera-view/respawn), death/respawn, night spawning, save round-trips, gameplay event emission (block break/place, hurt, eat, jump/land, mob attack/hit)                                                         |
| Audio data           | `lib/game/audio/{materials,soundParams}.test.ts`                                                                                      | Every `BlockId` has a material group; every group/`MobKind` has well-formed ZZFX sound entries                                                                                                                                                                                                              |
| Audio schedulers     | `lib/game/audio/{footsteps,mobAmbience,musicBrain}.test.ts`                                                                           | Stride cadence and airborne reset; earshot gating, distance gain, look-relative pan, seeded call intervals; notes stay on scale, day/night/biome moods, deterministic under a seeded rng                                                                                                                    |
| Audio routing        | `lib/game/audio/audioDirector.test.ts`                                                                                                | With an injected fake `SynthBackend`: events → correct sound tables, staged mining ticks, footsteps while walking, pause ducking, mute/volume application                                                                                                                                                   |
| Audio settings       | `lib/game/audio/settings.test.ts`                                                                                                     | Round-trips, corrupt-data fallback, range clamping (own localStorage key, not the world save)                                                                                                                                                                                                               |
| UI sprites           | `lib/ui/*.test.ts`                                                                                                                    | Every item id renders a non-empty deterministic 16×16 sprite; HUD icon variants (full/half/container) differ                                                                                                                                                                                                |
| Minimap sampling     | `lib/game/render/minimapColors.test.ts`                                                                                               | Top-block detection (water visible), height shading, per-block colors                                                                                                                                                                                                                                       |
| Renderer logic       | `lib/game/render/{mobVisuals,heldItem,heldItemPose,extrudedSprite,itemModel,playerModel,playerPose,playerVisuals,cameraView}.test.ts` | Model lifecycle (create/reuse/remove/dispose), positioning, bob, item swaps, held-item swing/equip/bob poses, sprite-extrusion face culling and vertex colors, player-body gait/chop poses and visibility per camera mode, third-person camera placement (rear/front, clamped boom) — pure Three.js, no DOM |
| Components           | `components/game/*.test.tsx`                                                                                                          | InventoryPanel click-to-swap/equip/craft gating, Hotbar slots, StatusBars heart/hunger/armor meters, PauseMenu, DeathScreen (happy-dom + Testing Library)                                                                                                                                                   |
| Browser E2E          | `e2e/smoke.e2e.ts`                                                                                                                    | Real browser: boot without console errors, scene draws, input → movement, craft via UI, mining, camera view cycling, pause freeze/resume, save via pause menu across reload                                                                                                                                 |

## Running the E2E suite

```bash
bunx playwright install chromium   # once
bun run test:e2e                   # builds and starts the prod server itself
```

E2E tests assert through `window.__monecraft` (the live engine/renderer/input handle — also handy in the browser console) instead of pixels; the one render check uses `renderer.renderedTriangles()`. The shared fixture fails any test that logs a console error.

**happy-dom has no 2D canvas context**: generated sprites degrade to a transparent data URL in component tests — assert sprite pixels in the pure `lib/ui` tests and component structure via roles/labels/`data-icon` attributes, not image sources.

**happy-dom has no `AudioContext`** (and the `zzfx` package instantiates one at import): everything above the `SynthBackend` seam is pure and tested with a recording fake (see `audioDirector.test.ts`); the WebAudio glue itself (`synth.ts`, `musicPlayer.ts`) plus real synthesis quality belong to the manual gameplay pass.

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
