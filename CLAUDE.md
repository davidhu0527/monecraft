# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A Minecraft-inspired voxel game built with Next.js 14 (App Router), TypeScript (strict), Three.js, and Bun. Single-player, browser-based, saves to localStorage. The entire game is client-only — `"use client"` components, with Three.js / canvas / localStorage touched only inside effects.

## Commands

```bash
bun install     # Install dependencies
bun run dev     # Dev server at http://localhost:3000
bun run build   # Production build + type checking — run before committing; this is the verification baseline
bun run lint    # Next.js ESLint
```

There is no test suite. For gameplay changes, manually verify in the browser:

- Movement (walk/sprint/jump/crouch), collisions, no false unstuck teleports
- Mining (crack overlay progresses, correct drops) and placing
- Crafting and inventory/durability behavior
- Save/load across a page reload (autosaves every 15s and on unload)
- Mob behavior at day vs night
- Day-night lighting cycle

## Architecture

Three layers: React UI → game engine hook → voxel world.

### UI layer (`app/`, `components/`)
- `app/page.tsx` mounts `components/MinecraftGame.tsx`, which orchestrates the 3D canvas and 2D HUD.
- `components/game/` holds the HUD pieces: `Hud`, `Hotbar`, `InventoryPanel`, `RespawnOverlay`.
- Global styles are split across `app/base.css`, `app/hud.css`, `app/ui.css`.

### Game engine (`lib/game/`)
- `useMinecraftGame.ts` (~1100 lines) is the central hook: it builds the Three.js scene on mount and runs the `requestAnimationFrame` loop. Per-frame order:
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
- **Refs-vs-state bridge**: every gameplay value (inventory, selected slot, armor, …) exists twice — React state for the UI and a ref (`inventoryRef`, `selectedSlotRef`, …) as the live store read by the loop and event listeners; refs are synced from state via `useEffect`. The loop reads/writes refs and pushes state selectively (e.g. `setHearts` only on change). Updating only the state or only the ref is the classic bug here.
- `config.ts` is the single source of truth for tunables: player physics, world dimensions (`WORLD_SIZE_*` in `lib/world.ts`, 512×150×512), `BREAK_HARDNESS`, `ITEM_DEFS`, `RECIPES`, `RENDER_RADIUS`, `RENDER_GRID`, `SAVE_KEY`.
- `types.ts` defines shared entities (including the save schema); `save.ts` + `runtime/persistence.ts` handle localStorage.

### World layer (`lib/world.ts`)
- `VoxelWorld` stores voxels in a flat `Uint8Array` (index = `x + z*sizeX + y*sizeX*sizeZ`) and handles procedural generation (biomes, caves, ores, structures), raycasting, and collision queries.
- **Meshing**: one mesh covers the visible region (not chunked). `buildGeometryRegion` rebuilds it when the player crosses a `RENDER_GRID` (20-block) boundary, or immediately via `rebuildWorldMesh(true)` after block edits, respawn, or manual unstuck. Old geometry is disposed on rebuild.
- Textures come from a runtime canvas block atlas (`createBlockAtlasTexture`) — tiles are generated from `BLOCK_COLORS`, no image assets.

## Adding things

**A new block:**
1. Add to the `BlockId` enum and `BLOCK_COLORS` in `lib/world.ts` — the atlas auto-generates its tile.
2. Add a `BREAK_HARDNESS` entry in `lib/game/config.ts` (omitted blocks default to hardness 2).
3. Make it placeable/droppable: an `ITEM_DEFS` entry (`kind: "block"`, `blockId`) plus a `BLOCK_TO_SLOT` mapping — without the mapping, mining it drops nothing.
4. Optionally add `RECIPES` entries.
5. Non-solid or transparent blocks need engine work: `isSolid()` in `lib/world.ts` for collisions, and face-visibility logic in `buildGeometryRegion` (see the water gotcha below).

**A new item or recipe:** add to `ITEM_DEFS` in `config.ts` — tools take `minePower`/`mineTier`/`maxDurability`, weapons `attack`/`maxDurability`, armor `armorSlot`/`defense`/`maxDurability`. `ITEM_DEF_BY_ID` is derived from `ITEM_DEFS`; never edit it directly. Recipes are `{ id, label, cost: [{slotId, count}], result: {slotId, count} }` in `RECIPES`. Items with durability don't stack; durability is initialized in `createSlot` and persisted in saves.

**A new mob:** add a template to `MOB_TEMPLATES` in `lib/game/mobs.ts` — `detectRange: 0` means passive (wanders, flees the player), `> 0` means hostile (chases, attacks with line-of-sight check). The model is assembled from `createMobModel(...)` color/size args in `lib/game/mobModel.ts` (legs animate automatically). Wire spawning in `useMinecraftGame.ts`: initial spawn at start, and the night respawn loop for hostiles.

## Save system & compatibility

- Schema: `SaveDataV1` in `lib/game/types.ts` — world `seed`, a block **diff** list (`changes: [blockIndex, blockId][]`; edits that revert to the generated baseline are pruned), inventory slots with durability, equipped armor, selected slot, player position. Stored in localStorage under `SAVE_KEY` (`minecraft_save_v4`).
- Autosave every 15s plus on `beforeunload`.
- **Compatibility rules:** saves store diffs against generated terrain, so changing world generation or the voxel index formula silently corrupts existing saves — bump `SAVE_KEY` when you do. Changing the save shape requires bumping the `version` field and handling (or discarding) old data. Note save-format/worldgen impact in PRs.

## Gotchas

Hard-won invariants — easy to silently break:

- **Water is special in meshing**: it's the only block whose faces render even against a same-type neighbor in `buildGeometryRegion`, and the single world material is `THREE.DoubleSide` so water is visible from inside. There is one material for all blocks — per-block render settings require restructuring. New transparent blocks must extend this face logic.
- **Being in water is not "stuck"**: the unstuck teleport fires only on solid-block overlap or falling below the world (y < 2). Don't make water count as a collision in `collidesAt` — players are allowed to stay submerged.
- **Crack overlay**: 8 pre-rendered canvas stages; stage = mining progress normalized by the block's hardness; drawn with `polygonOffset` so it sits on the block face.
- **Daylight thresholds** (daylight ranges 0.04–1.0): hostiles night-spawn below 0.28; spiders are hostile only below 0.42 (passive in twilight); zombies/skeletons burn above 0.72.
- **Pointer lock**: the first left-click only acquires pointer lock (no mining); `KeyI` (inventory) explicitly exits lock; right-click places without requiring lock.
- **Client-only**: never touch `window`/`document`/localStorage at module top level — everything runs behind `"use client"` and mounts inside `useEffect`.

## Conventions

- TypeScript strict; 2-space indentation; imports grouped by domain.
- `PascalCase` components/types, `camelCase` functions/variables, `UPPER_SNAKE_CASE` constants.
- Imperative, scoped commit messages (e.g. `Add block breaking crack overlay`); keep `bun run build` green at each commit.
- Prefer small modules in `lib/game/` and `lib/game/runtime/` over inline blocks in the hook.

## Context compression hints

When compressing conversation history, preserve in priority order: (1) deviations from constraints in this file, (2) which files changed and why, (3) save-format / worldgen compatibility impact, (4) `bun run build` pass/fail state. Raw tool output can be dropped.

## Reference docs

- `AGENTS.md` and `GEMINI.md` — sibling guidance files for other agents with overlapping content. This file is canonical for Claude Code; when commands or conventions change, keep all three consistent.
- `README.md` — player-facing controls and quick start.
