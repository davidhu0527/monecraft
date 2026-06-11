# Architecture

Three layers: React UI → game engine hook → voxel world. React state/refs bridge the declarative UI with the imperative Three.js game loop.

## UI layer (`app/`, `components/`)

- `app/page.tsx` mounts `components/MinecraftGame.tsx`, which orchestrates the 3D canvas and 2D HUD.
- `components/game/` holds the HUD pieces: `Hud`, `Hotbar`, `InventoryPanel`, `RespawnOverlay`.
- Global styles are split across `app/base.css`, `app/hud.css`, `app/ui.css`.

## Game engine (`lib/game/`)

`useMinecraftGame.ts` (~1100 lines) is the central hook: it builds the Three.js scene on mount and runs the `requestAnimationFrame` loop.

### Per-frame loop order

1. Stuck detection / unstuck teleport
2. Death check + respawn timer
3. Player movement & physics (`tickPlayerMovement` from `runtime/playerMotion.ts`)
4. Energy drain (sprint/walk/jump budgets) and health regen
5. Mining progress (`processMining` from `runtime/miningCombat.ts`) + crack overlay update
6. Day-night cycle (`tickDayNight` from `runtime/dayNight.ts`)
7. Night hostile spawning (every 10s while dark, capped)
8. Mob AI (`tickMobs` from `runtime/mobs.ts`)
9. Conditional world mesh rebuild, then camera update + render

New mechanics go in a separate `lib/game/runtime/` module and get a slot in this sequence — don't grow the hook with inline logic.

### Refs-vs-state bridge

Every gameplay value (inventory, selected slot, armor, …) exists twice — React state for the UI and a ref (`inventoryRef`, `selectedSlotRef`, …) as the live store read by the loop and event listeners; refs are synced from state via `useEffect`. The loop reads/writes refs and pushes state selectively (e.g. `setHearts` only on change). Updating only the state or only the ref is the classic bug here.

### Config and types

- `config.ts` is the single source of truth for tunables: player physics, `BREAK_HARDNESS`, `ITEM_DEFS`, `RECIPES`, `RENDER_RADIUS`, `RENDER_GRID`, `SAVE_KEY`. World dimensions live in `lib/world.ts` (`WORLD_SIZE_*`, 512×150×512).
- `types.ts` defines shared entities (including the save schema); `save.ts` + `runtime/persistence.ts` handle localStorage (see [save-format.md](save-format.md)).

## World layer (`lib/world.ts`)

- `VoxelWorld` stores voxels in a flat `Uint8Array` (index = `x + z*sizeX + y*sizeX*sizeZ`) and handles procedural generation (biomes, caves, ores, structures), raycasting, and collision queries.
- **Meshing**: one mesh covers the visible region (not chunked). `buildGeometryRegion` rebuilds it when the player crosses a `RENDER_GRID` (20-block) boundary, or immediately via `rebuildWorldMesh(true)` after block edits, respawn, or manual unstuck. Old geometry is disposed on rebuild.
- Textures come from a runtime canvas block atlas (`createBlockAtlasTexture`) — tiles are generated from `BLOCK_COLORS`, no image assets.

## Engine invariants & gotchas

Hard-won invariants — easy to silently break:

- **Water is special in meshing**: it's the only block whose faces render even against a same-type neighbor in `buildGeometryRegion`, and the single world material is `THREE.DoubleSide` so water is visible from inside. There is one material for all blocks — per-block render settings require restructuring. New transparent blocks must extend this face logic.
- **Being in water is not "stuck"**: the unstuck teleport fires only on solid-block overlap or falling below the world (y < 2). Don't make water count as a collision in `collidesAt` — players are allowed to stay submerged.
- **Crack overlay**: 8 pre-rendered canvas stages; stage = mining progress normalized by the block's hardness; drawn with `polygonOffset` so it sits on the block face.
- **Daylight thresholds** (daylight ranges 0.04–1.0): hostiles night-spawn below 0.28; spiders are hostile only below 0.42 (passive in twilight); zombies/skeletons burn above 0.72.
- **Pointer lock**: the first left-click only acquires pointer lock (no mining); `KeyI` (inventory) explicitly exits lock; right-click places without requiring lock.
- **Client-only**: never touch `window`/`document`/localStorage at module top level — everything runs behind `"use client"` and mounts inside `useEffect`.
