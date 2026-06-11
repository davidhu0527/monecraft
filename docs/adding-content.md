# Adding content

Step-by-step recipes for extending the game. See [architecture.md](architecture.md) for how these pieces fit together.

## A new block

1. Add to the `BlockId` enum and `BLOCK_COLORS` in `lib/world/blocks.ts` — the atlas auto-generates its tile. Add a `HELD_BLOCK_COLORS` entry for the first-person model tint.
2. Add a `BREAK_HARDNESS` entry in `lib/game/items.ts` (omitted blocks default to hardness 2).
3. Make it placeable/droppable: an `ITEM_DEFS` entry (`kind: "block"`, `blockId`) plus a `BLOCK_TO_SLOT` mapping — without the mapping, mining it drops nothing. The inventory icon (isometric cube) auto-generates from `BLOCK_COLORS`; ore-style blocks can add an accent color in `lib/ui/spritePixels.ts` (`ORE_ACCENTS`).
4. Optionally add `RECIPES` entries in `lib/game/recipes.ts`.
5. Non-solid or transparent blocks need engine work: `isSolid()` in `lib/world/voxelWorld.ts` for collisions, and face-visibility logic in `lib/world/meshing.ts` (see the water gotcha in [architecture.md](architecture.md)).
6. The item/recipe integrity tests (`lib/game/config.test.ts`) will fail if a mapping is missing or inconsistent — run `bun test`.

## A new item or recipe

- Add to `ITEM_DEFS` in `lib/game/items.ts` — tools take `minePower`/`mineTier`/`maxDurability`, weapons `attack`/`maxDurability`, armor `armorSlot`/`defense`/`maxDurability`.
- Give it an inventory sprite in `lib/ui/spritePixels.ts`: tools/swords get one for free if the id is `<material>_pickaxe`/`<material>_sword` and the material exists in `MATERIAL_PALETTES`; a new material needs a palette entry, a new shape needs a 16×16 grid. The `lib/ui/spritePixels.test.ts` integrity test fails on ids that fall back to the placeholder checker — by design.
- `ITEM_DEF_BY_ID` is derived from `ITEM_DEFS`; never edit it directly.
- Recipes are `{ id, label, cost: [{slotId, count}], result: {slotId, count} }` in `lib/game/recipes.ts`.
- Items with durability don't stack; durability is initialized in `createSlot` and persisted in saves.

## A new mob

- Add a template to `MOB_TEMPLATES` in `lib/game/mobs.ts` — `detectRange: 0` means passive (wanders, flees the player), `> 0` means hostile (chases, attacks with line-of-sight check).
- The model is assembled from `createMobModel(...)` color/size args in `lib/game/mobModel.ts` (legs animate automatically in `lib/game/render/mobVisuals.ts`).
- Wire spawning in `lib/game/engine/systems/spawnDirector.ts`: `spawnInitialMobs` for the day-one population, `tickHostileSpawnDirector` for the night respawn loop.
- A headless test in `lib/game/engine/GameEngine.test.ts` is cheap: boot the engine, fast-forward to night, assert the mob appears/behaves.

## A new mechanic

Add a system module under `lib/game/engine/systems/` (a function over `GameState`), give it a slot in the `GameEngine.step` sequence, and put its tunables in `lib/game/config.ts`. If the UI triggers it, add a `Command` variant. Write its headless test next to it.
