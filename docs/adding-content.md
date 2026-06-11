# Adding content

Step-by-step recipes for extending the game. See [architecture.md](architecture.md) for how these pieces fit together.

## A new block

1. Add to the `BlockId` enum and `BLOCK_COLORS` in `lib/world.ts` — the atlas auto-generates its tile.
2. Add a `BREAK_HARDNESS` entry in `lib/game/config.ts` (omitted blocks default to hardness 2).
3. Make it placeable/droppable: an `ITEM_DEFS` entry (`kind: "block"`, `blockId`) plus a `BLOCK_TO_SLOT` mapping — without the mapping, mining it drops nothing.
4. Optionally add `RECIPES` entries.
5. Non-solid or transparent blocks need engine work: `isSolid()` in `lib/world.ts` for collisions, and face-visibility logic in `buildGeometryRegion` (see the water gotcha in [architecture.md](architecture.md)).

## A new item or recipe

- Add to `ITEM_DEFS` in `lib/game/config.ts` — tools take `minePower`/`mineTier`/`maxDurability`, weapons `attack`/`maxDurability`, armor `armorSlot`/`defense`/`maxDurability`.
- `ITEM_DEF_BY_ID` is derived from `ITEM_DEFS`; never edit it directly.
- Recipes are `{ id, label, cost: [{slotId, count}], result: {slotId, count} }` in `RECIPES`.
- Items with durability don't stack; durability is initialized in `createSlot` and persisted in saves.

## A new mob

- Add a template to `MOB_TEMPLATES` in `lib/game/mobs.ts` — `detectRange: 0` means passive (wanders, flees the player), `> 0` means hostile (chases, attacks with line-of-sight check).
- The model is assembled from `createMobModel(...)` color/size args in `lib/game/mobModel.ts` (legs animate automatically).
- Wire spawning in `useMinecraftGame.ts`: initial spawn at start, and the night respawn loop for hostiles.
