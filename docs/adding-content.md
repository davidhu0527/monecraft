# Adding content

Step-by-step recipes for extending the game. See [architecture.md](architecture.md) for how these pieces fit together.

## A new block

1. Add to the `BlockId` enum and `BLOCK_COLORS` in `lib/world/blocks.ts` — the atlas auto-generates its tile. Add a `HELD_BLOCK_COLORS` entry for the first-person model tint.
2. Add a `BREAK_HARDNESS` entry in `lib/game/items.ts` (omitted blocks default to hardness 2).
3. Make it placeable/droppable: an `ITEM_DEFS` entry (`kind: "block"`, `blockId`) plus a `BLOCK_TO_SLOT` mapping — without the mapping, mining it drops nothing. The inventory icon (isometric cube) auto-generates from `BLOCK_COLORS`; ore-style blocks can add an accent color in `lib/ui/spritePixels.ts` (`ORE_ACCENTS`).
4. Optionally add `RECIPES` entries in `lib/game/recipes.ts`.
5. Non-solid or transparent blocks need engine work: `isSolid()` in `lib/world/voxelWorld.ts` for collisions, and face-visibility logic in `lib/world/meshing.ts` (see the water gotcha in [architecture.md](architecture.md)).
6. Map it to a sound family in `lib/game/audio/materials.ts` — the `BlockId → MaterialGroup` record is exhaustive, so typecheck fails until the entry exists.
7. The item/recipe integrity tests (`lib/game/config.test.ts`) will fail if a mapping is missing or inconsistent — run `bun test`.

## A new item or recipe

- Add to `ITEM_DEFS` in `lib/game/items.ts` — tools take `minePower`/`mineTier`/`maxDurability`, weapons `attack`/`maxDurability`, armor `armorSlot`/`defense`/`maxDurability`. `kind: "food"` items take a `hunger` value (restored on eat); `kind: "material"` items are inert craft ingredients.
- Give it an inventory sprite in `lib/ui/spritePixels.ts`: tools/swords get one for free if the id is `<material>_pickaxe`/`<material>_sword` and the material exists in `MATERIAL_PALETTES`; food/material items need a 16×16 grid + palette wired into the `ITEM_SPRITE_GRIDS` map (keyed by item id). The `lib/ui/spritePixels.test.ts` integrity test fails on ids that fall back to the placeholder checker — by design.
- `ITEM_DEF_BY_ID` is derived from `ITEM_DEFS`; never edit it directly.
- Recipes are `{ id, label, cost: [{slotId, count}], result: {slotId, count} }` in `lib/game/recipes.ts`. An optional `station` (e.g. `"furnace"`) makes a recipe a smelting recipe: it only crafts while that station's panel is open, enforced in the `craft` command and shown locked in the recipe book.
- Items with durability don't stack; durability is initialized in `createSlot` and persisted in saves.

## A new mob drop

- Mob loot lives in `lib/game/mobLoot.ts`: add or edit the `MOB_DROPS[kind]` entries (`{ itemId, min, max, chance? }`). `rollMobDrops` is the single roll, called once from `GameEngine.removeMobAt` for every death (combat kills and daylight burns alike), so there is nothing else to wire.
- Every `itemId` must exist in `ITEM_DEFS`; `lib/game/mobLoot.test.ts` enforces that and the count bounds.

## A new mob

- Add a template to `MOB_TEMPLATES` in `lib/game/mobs.ts` — `detectRange: 0` means passive (wanders, flees the player), `> 0` means hostile (chases, attacks with line-of-sight check).
- The model is assembled from `createMobModel(...)` color/size args in `lib/game/mobModel.ts` (legs animate automatically in `lib/game/render/mobVisuals.ts`).
- Wire spawning in `lib/game/engine/systems/spawnDirector.ts`: `spawnInitialMobs` for the day-one population, `tickHostileSpawnDirector` for the night respawn loop.
- Give it a voice: `MOB_AMBIENT_SOUNDS` and `MOB_ATTACK_SOUNDS` rows in `lib/game/audio/soundParams.ts`, and a call interval in `lib/game/audio/mobAmbience.ts` (`CALL_INTERVALS`) — all keyed by `MobKind`, so typecheck enforces them.
- A headless test in `lib/game/engine/GameEngine.test.ts` is cheap: boot the engine, fast-forward to night, assert the mob appears/behaves.

## A new player skin preset

- Add an entry to `SKIN_PRESETS` in `lib/game/playerSkins.ts` (id, label, seven-color palette). That's the whole feature: the pause-menu grid, the generated bust portrait (`lib/ui/skinPortrait.ts`), and the 3D body recolor all derive from the palette.
- The `SkinId` union and the preset integrity tests (`playerSkins.test.ts`, `skinPortrait.test.ts`) enforce consistency at typecheck/test time — a new id is automatically validated in storage and rendered in the picker.
- Judge the colors by eye: `bun run dev`, V for third person, Esc → Appearance.

## A new sound

- One-shots ride on engine events: add a variant to `GameEvent` (`lib/game/engine/state.ts`), emit it from the relevant system via the injected `emit` callback, and route it in `audioDirector.ts`'s `handleEvent`. Continuous sounds derive from state in the director's `sync` instead.
- Design the sound by ear in the [ZZFX designer](https://killedbyapixel.github.io/ZzFX/), then transcribe the parameters into a `SoundDef` in `lib/game/audio/soundParams.ts` using the named-field `zz({...})` helper (field order matches the designer's positional array).
- Coverage is pinned: `materials.test.ts` and `soundParams.test.ts` fail on missing material/mob rows, and routing is testable headlessly with the fake `SynthBackend` pattern in `audioDirector.test.ts`. Actual sound quality is a manual `bun run dev` pass.

## An interactive block (right-click behavior)

- Right-click (and KeyE) dispatch `placeBlock`, which runs a fixed precedence in `GameEngine.dispatch` before falling through to placement: feed an aimed mob → `tryInteractBlock` → use the held item → place. To make a block do something on right-click, register it in `INTERACTIVE_BLOCKS` and add a branch in `tryInteractBlock` (`lib/game/engine/systems/interact.ts`).
- The handler returns `true` to consume the click (no block is placed) — return `true` even when the action is refused (e.g. a bed during the day) so the player doesn't place a block into the bed by accident.
- Two reference implementations: the **bed** sets `state.spawnPoint` and starts the sleep fade (`state.sleepTimer`); the **furnace** opens the inventory and sets `state.craftingStation`, which unlocks its `station` recipes (see "A new item or recipe"). A station-opening block also needs an `openedStation` handler in `useMinecraftGame` to release pointer lock. See [architecture.md](architecture.md) for the step order.

## A random-tick behavior (growth / spread)

- Block updates that happen "over time" run through `lib/game/engine/systems/randomTicks.ts`: every `RANDOM_TICK_INTERVAL_SECONDS` it samples `RANDOM_TICK_SAMPLES` columns within `RANDOM_TICK_RADIUS` of the player and runs a handler on each column's top block. Register a `BlockId → handler` in `RANDOM_TICK_HANDLERS`; the handler edits via `state.blockChanges` and sets `state.worldMeshDirty`.
- The crop handler is the reference: wheat stage ids are consecutive, so growth is `block + 1`, and the mature stage has no handler so it stops. Because crops are ordinary block edits, they persist for free via the save's block diff — no new save fields.
- Tunables live in `config.ts`; the headless test pattern (a minimal `GameState`, a scripted rng that maps a sample onto a known column) is in `randomTicks.test.ts`.

## A new mechanic

Add a system module under `lib/game/engine/systems/` (a function over `GameState`), give it a slot in the `GameEngine.step` sequence, and put its tunables in `lib/game/config.ts`. If the UI triggers it, add a `Command` variant. Write its headless test next to it.
