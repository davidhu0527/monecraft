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
- To make a passive animal **breedable**, add it to `FEED_ITEMS` in `lib/game/engine/systems/interact.ts` (which food puts it "in love"). Breeding itself is generic: `lib/game/engine/systems/breeding.ts` pairs two fed adults of the same kind into a baby (scaled down via `ageTimer`/`BABY_SCALE`, no drops until grown), bounded by `PASSIVE_CAP`. `MobState.fedTimer`/`ageTimer` and the tunables in `config.ts` drive it; mobs are never persisted, so this is session-only by design.

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
- Three reference implementations: the **bed** sets `state.spawnPoint` and starts the sleep fade (`state.sleepTimer`); the **furnace** opens the inventory and sets `state.craftingStation`, which unlocks its `station` recipes (see "A new item or recipe"); the **chest** opens the inventory and sets `state.openContainerIndex` (see below). A block that opens the inventory from a mouse click also needs an `openedStation`/`openedContainer` handler in `useMinecraftGame` to release pointer lock. See [architecture.md](architecture.md) for the step order.

## A container block (block-entity storage)

- Blocks are bare `BlockId`s, so any block that needs **attached data** (a chest's items) stores it in `state.containers: Map<voxelIndex, InventorySlot[]>`, keyed by `world.index(x,y,z)`. The chest is the reference:
  - **Open**: `interactChest` (an `INTERACTIVE_BLOCKS` branch) lazily creates the slot array, sets `state.openContainerIndex`, opens the inventory, and emits `openedContainer`. The snapshot exposes `container`, and `InventoryPanel` renders a second grid; `toggleInventory`/`pause` clear `openContainerIndex`.
  - **Move items**: the `moveStack` command swaps a slot across the inventory/chest boundary using the pure `inventory.moveStack` (chest indices offset by `CONTAINER_SLOT_BASE` in `commands.ts`).
  - **Place / break**: placing the block (`mining.placeSelectedBlock`) seeds an empty container; breaking it spills the contents into the inventory via `inventory.tryInsertSlots` (all-or-nothing — a break is refused with a `breakBlocked` event when they don't fit).
  - **Persist**: `serialize()` writes non-empty containers to `blockEntities` (`save.serializeContainers`); boot restores them (`save.readContainers`) only for indices that still hold the block. This is an **additive save bump** — see [save-format.md](save-format.md).

## A random-tick behavior (growth / spread)

- Block updates that happen "over time" run through `lib/game/engine/systems/randomTicks.ts`: every `RANDOM_TICK_INTERVAL_SECONDS` it samples `RANDOM_TICK_SAMPLES` columns within `RANDOM_TICK_RADIUS` of the player and runs a handler on each column's top block. Register a `BlockId → handler` in `RANDOM_TICK_HANDLERS`; the handler edits via `state.blockChanges` and sets `state.worldMeshDirty`.
- The crop handler is the reference: wheat stage ids are consecutive, so growth is `block + 1`, and the mature stage has no handler so it stops. Because crops are ordinary block edits, they persist for free via the save's block diff — no new save fields.
- Tunables live in `config.ts`; the headless test pattern (a minimal `GameState`, a scripted rng that maps a sample onto a known column) is in `randomTicks.test.ts`.

## A worldgen structure (houses, dungeons, …)

- Structures are placed in `lib/world/generation.ts` at the end of the `generateWorld` pipeline. Mirror `placeHouse`/`placeDungeons`: loop a `GEN.<thing>Count`, sample positions, validate, and write blocks with `world.set`. Append your pass **last** so later passes don't overwrite it, and add the count to the frozen `GEN` object.
- **Any block write changes the deterministic output**, so this breaks the worldgen hash. Re-baseline the `generation.test.ts` digests and bump `SAVE_KEY` per the [testing.md](testing.md) policy; add a structural probe test (count your blocks, assert they generate) that survives the re-baseline.
- If the structure needs its positions known at runtime (dungeons re-derive chest/spawner indices on load), expose a **derive pass** like `collectDungeonSites`: factor placement into a shared routine that either writes blocks or records indices, drawing from a **dedicated PRNG seeded only from `world.seed`** (not the shared gen stream) with a fixed number of draws per structure, and validate against **seed-pure** terrain (`terrainTopY`, `getBiome`) — never `highestSolidY`, which a cave or player edit can shift out from under the derive pass.

## A loot table / lazy block-entity fill

- Drop tables are pure data + a roll function: copy the `{ itemId, min, max, chance? }` shape and the `clampUnit` roll loop from `lib/game/mobLoot.ts` / `lib/game/dungeonLoot.ts`. Add a `*.test.ts` asserting every `itemId` exists in `ITEM_DEFS` and that rolls are deterministic under an injected rng.
- To fill a **worldgen-placed** block-entity (a dungeon chest) whose contents can't live in the block-diff baseline: fill it lazily on first access, seeded from `world.seed ^ voxelIndex` (`dungeonLoot.seededRng`), and persist a set of _accessed_ indices (additive save field) — gate the fill on that set, **not** on whether the container is currently non-empty, or an emptied-then-reloaded entity re-rolls. `lib/game/engine/systems/dungeon.ts` (`fillDungeonChestIfUnlooted`), shared by the open and break paths, is the reference; see the exploit-guard test in `GameEngine.test.ts`.

## A new mechanic

Add a system module under `lib/game/engine/systems/` (a function over `GameState`), give it a slot in the `GameEngine.step` sequence, and put its tunables in `lib/game/config.ts`. If the UI triggers it, add a `Command` variant. Write its headless test next to it.
