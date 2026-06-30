# Adding content

Step-by-step recipes for extending the game. See [architecture.md](architecture.md) for how these pieces fit together.

## A new block

1. Add to the `BlockId` enum and `BLOCK_COLORS` in `lib/world/blocks.ts` — the atlas auto-generates its tile. Add a `HELD_BLOCK_COLORS` entry for the first-person model tint.
2. Add a `BREAK_HARDNESS` entry in `lib/game/items.ts` (omitted blocks default to hardness 2).
3. Make it placeable/droppable: an `ITEM_DEFS` entry (`kind: "block"`, `blockId`) plus a `BLOCK_TO_SLOT` mapping — without the mapping, mining it drops nothing. The inventory icon (isometric cube) auto-generates from `BLOCK_COLORS`; ore-style blocks can add an accent color in `lib/ui/spritePixels.ts` (`ORE_ACCENTS`).
4. Optionally add `RECIPES` entries in `lib/game/recipes.ts`.
5. Non-cube, non-solid, or transparent blocks need engine work: collision in `lib/world/queries.ts` / `voxelWorld.ts` and geometry/face visibility in `lib/world/meshing.ts`. Doors are the reference for shared custom bounds; glass is the reference for a separate render layer.
6. Map it to a sound family in `lib/game/audio/materials.ts` — the `BlockId → MaterialGroup` record is exhaustive, so typecheck fails until the entry exists.
7. Give it a **lighting class** in `lib/world/lighting.ts`: `opacity` (default is fully opaque — air/glass transmit, water/leaves attenuate) and `emission` (default 0; torches emit 14, lava 15). A light source self-illuminates and lights its neighborhood through the shared flood; an opaque block casts shadow. Both are exercised by `lib/world/lighting.test.ts`.
8. The item/recipe integrity tests (`lib/game/config.test.ts`) will fail if a mapping is missing or inconsistent — run `bun test`.

## A new item or recipe

- Add to `ITEM_DEFS` in `lib/game/items.ts` — tools take `minePower`/`mineTier`/`maxDurability`, weapons `attack`/`maxDurability`, armor `armorSlot`/`defense`/`maxDurability`. `kind: "food"` items take a `hunger` value (restored on eat); `kind: "material"` items are inert craft ingredients.
- Give it an inventory sprite in `lib/ui/spritePixels.ts`: pickaxes, swords, and
  spears get one for free when named `<material>_pickaxe`, `<material>_sword`, or
  `<material>_spear` and the material exists in `MATERIAL_PALETTES`;
  food/material items need a 16×16 grid + palette in `ITEM_SPRITE_GRIDS`. The
  sprite integrity test rejects placeholder fallbacks. A **tool with a non-material
  prefix** (e.g. `fishing_rod`) must either add a `MATERIAL_PALETTES` entry or use a
  custom `ITEM_SPRITE_GRIDS` grid AND be listed in the `customGrid` exempt set in
  `spritePixels.test.ts` — otherwise the tool-prefix-palette test fails.
- Any item with `maxDurability` is automatically non-stackable. Spears also set
  `meleeReach` and `throwDamage`; `systems/spears.ts` handles throwing.
- `ITEM_DEF_BY_ID` is derived from `ITEM_DEFS`; never edit it directly.
- Recipes are `{ id, label, cost: [{slotId, count}], result: {slotId, count} }` in `lib/game/recipes.ts`. An optional `station` makes a recipe station-gated: it only crafts while that station's panel is open, enforced in the `craft` command and shown locked in the recipe book. The stations are `"furnace"` (smelting), `"villager"` (a **trade** — see below), and `"brewing"` (potions, opened at a brewing stand). Adding a station means extending that union in **four** places (`Recipe.station` in `types.ts`, `craftingStation` on both `GameState` and `GameSnapshot` in `state.ts`, and the `openedStation` event), plus a `RecipeCategory` + a `recipeCategory()` branch and a `STATION_LABELS` entry (`InventoryPanel.tsx`).
- **Villager trades** (`lib/game/trades.ts`) ARE just `station: "villager"` recipes spread into `RECIPES`, so they reuse the whole crafting pipeline and recipe-book UI for free. To open them, an interaction sets `state.craftingStation = "villager"` (right-clicking a villager via `tryTradeAimedVillager` in `interact.ts`); the panel then shows the trades as a **Trading** book and the `craft` command runs them. Emerald is the currency — add sell offers (material → emerald) and buy offers (emerald → goods) to keep the economy two-sided. There's no persisted trade state, so this needs no save-format change.
- Items with durability don't stack; durability is initialized in `createSlot` and persisted in saves.
- **"How to obtain" hint**: the recipe-book tooltip tells the player where a missing ingredient comes from. `lib/game/itemSources.ts` derives this once from the existing tables (recipes → "craft/smelt/trade/brew it", `BLOCK_TO_SLOT` → "mine X", `MOB_DROPS` → "hunt X", fishing/dungeon loot), so a new recipe or drop is covered automatically. Only add to `MINE_OVERRIDES` there when the dropped item differs from the block you break (e.g. coal from coal ore, or a chance drop in `rollBlockDrops` like saplings/seeds).

## A new mob drop

- Mob loot lives in `lib/game/mobLoot.ts`: add or edit the `MOB_DROPS[kind]` entries (`{ itemId, min, max, chance? }`). `rollMobDrops` is the single roll, called once from `GameEngine.removeMobAt` for every death (combat kills and daylight burns alike), so there is nothing else to wire.
- Every `itemId` must exist in `ITEM_DEFS`; `lib/game/mobLoot.test.ts` enforces that and the count bounds.

## A new mob

- Add a template to `MOB_TEMPLATES` in `lib/game/mobs.ts` — `detectRange: 0` means passive (wanders, flees the player), `> 0` means hostile (chases, attacks with line-of-sight check). Also give it a `faction` in `FACTION_BY_KIND` (`mobs.ts`): the **targeting** axis (wild/hostile/ally/villager/raider) that drives who fights whom via the enmity table in `mobAI.ts`, distinct from the `hostile` flag (which gates caps, the health bar, and Peaceful despawn).
- The model is assembled from `createMobModel(...)` color/size args in `lib/game/mobModel.ts` (legs animate automatically in `lib/game/render/mobVisuals.ts`).
- Wire spawning in `lib/game/engine/systems/spawnDirector.ts`: `spawnInitialMobs` for the day-one population, `tickHostileSpawnDirector` for the night respawn loop.
- Give it a voice: `MOB_AMBIENT_SOUNDS` and `MOB_ATTACK_SOUNDS` rows in `lib/game/audio/soundParams.ts`, and a call interval in `lib/game/audio/mobAmbience.ts` (`CALL_INTERVALS`) — all keyed by `MobKind`, so typecheck enforces them.
- A headless test in `lib/game/engine/GameEngine.test.ts` is cheap: boot the engine, fast-forward to night, assert the mob appears/behaves.
- To make a passive animal **breedable**, add it to `FEED_ITEMS` in `lib/game/engine/systems/interact.ts` (which food puts it "in love"). Breeding itself is generic: `lib/game/engine/systems/breeding.ts` pairs two fed adults of the same kind into a baby (scaled down via `ageTimer`/`BABY_SCALE`, no drops until grown), bounded by `PASSIVE_CAP`. `spawnBaby` inherits the parent's `faction`/`owner`, so a bred pet's offspring is an owned ally too. `MobState.fedTimer`/`ageTimer` and the tunables in `config.ts` drive it.
- **A tameable companion** is a passive kind plus an entry in `TAME_ITEMS` (`interact.ts`) — its treat. `tryTameAimedMob` flips a wild one to `owner: "player"` + `faction: "ally"` on a `TAME_CHANCE` roll and raises its hp/`detectRange`; the `ally` branch in `mobAI.ts` then makes it follow, sit (`tryToggleSitPet`), and fight via the shared mob-vs-mob targeting. Wire the right-click order in `GameEngine.dispatch` (tame → feed → sit) and the `mobTamed`/`petSitToggled` events (`state.ts`) to audio/particles.
- **Persistence.** Mobs are session-only **unless** `isPersistentMob` (`save.ts`) matches — currently tamed pets (`owner` set). A persistent kind round-trips through `serializeMobs`/`restoreMobs` (`SavedMob` in `types.ts`, save **v14+**); the engine's `restorePersistedMobs` rebuilds the live `MobState` before `spawnInitialMobs`. The fungible wild/hostile population is re-seeded each boot, so don't persist it (it would just duplicate).
- **A new `MobKind` touches seven exhaustive `Record<MobKind>` tables** (typecheck enforces all of them): `MOB_TEMPLATES` + `FACTION_BY_KIND` (`mobs.ts`), `MOB_DROPS` (`mobLoot.ts`), `MOB_XP` (`mobXp.ts`), `CALL_INTERVALS` (`mobAmbience.ts`), and `MOB_AMBIENT_SOUNDS` + `MOB_ATTACK_SOUNDS` (`soundParams.ts`). Also decide its `HOSTILE_MOB_KINDS` membership (`mobs.ts`). `soundParams.test.ts` iterates `MOB_TEMPLATES`, so the sound/template tables stay in lockstep.

## A ranged weapon or ranged mob

- Arrows ride the shared **projectile system** (`lib/game/engine/projectiles.ts`, `engine/systems/projectileAI.ts`): call `spawnArrow(state, x, y, z, dir, { speed, damage, knockback, fromPlayer, ttl })`. `fromPlayer: true` hits mobs, `false` hits the player; arrows never hit their firer. Projectiles are session-only `ProjectileState` (never serialized).
- A **player ranged weapon** branches the `attack` command: gate on the held item (see `isBow`/`tryFireBow` in `combat.ts`) and fire instead of meleeing. Use a `config.ts` cooldown timer (`GameTimers`, decremented in `GameEngine.step`) for fire rate, and spend ammo + durability via `adjustSlotCount` / `consumeToolDurability`.
- A **ranged mob** sets `ranged: true` on its `MobTemplate`; `mobAI.ts` then makes it kite (a standoff band) and fire toward the player's chest (with simple lead) instead of meleeing. The boss is the special case there: it approaches, melees up close, fires a spread, and summons minions — see `fireBossSpread` / `tickBossSummon`.
- The renderer auto-renders any arrow via `projectileVisuals.ts` (a pooled extruded `arrow` sprite); add an impact event (e.g. `arrowHit`) for particles/sound if you want feedback.

## An explosion (creeper, TNT, or anything that blows up)

- The blast itself is one reusable primitive: `explode(state, cx, cy, cz, power, deps)` in `lib/game/engine/systems/explosion.ts`. It destroys blocks in a `power`-radius sphere (distance falloff vs each block's `blastResistance`, skipping the unbreakable set), then damages the player and mobs out to **twice** that radius with the same falloff, applies knockback, and emits one `explosion` event. `deps` is `{ applyDamage, rng, emit }` — a subset of `MobTickDeps`, so a mob can pass its own `deps` straight in.
- It is **not** a new subsystem: it batches over the existing `blockChanges.set` chokepoint (each removed cell relights locally and records the save delta) and sets `worldMeshDirty` **once**, so a whole crater costs a single remesh — the same one a single mined block pays. It only lowers mob hp (never splices), so it is safe to call mid `tickMobs`; the caller sweeps any mob at 0 hp.
- To give a new thing a blast, just call `explode(...)`. The **creeper** lights a fuse near the player then detonates (`mobAI.ts`, `MobState.fuseTimer`); **TNT** is a placeable block lit by right-clicking it with a torch (`primeTnt` in `interact.tryUseHeldItem`), counted down and detonated by `tickPrimedTnt` (a `state.primedTnt` map, session-only). Both are transient — nothing here is serialized.
- Tunables (power, fuses, peak damage, chain delay) live in `config.ts`; the per-block `blastResistance` and unbreakable set live in `explosion.ts`. Cover new blasts in `explosion.test.ts` (headless: assert the crater, spared unbreakables, falloff, one remesh/event).

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
- Four reference implementations: the **door** atomically toggles matching upper/lower state IDs; the **bed** sets `state.spawnPoint` and starts the sleep fade (`state.sleepTimer`); the **furnace** opens the inventory and sets `state.craftingStation`, which unlocks its `station` recipes (see "A new item or recipe"); the **chest** opens the inventory and sets `state.openContainerIndex` (see below). A block that opens the inventory from a mouse click also needs an `openedStation`/`openedContainer` handler in `useMinecraftGame` to release pointer lock. See [architecture.md](architecture.md) for the step order.
- **A station with its own panel (not the recipe book)** — the **enchanting table**, the **anvil**, and the **grindstone** are the reference. Their interaction sets `state.craftingStation` to a new id, but that id goes on the **engine/UI** station union (`craftingStation` on `GameState` and `GameSnapshot`, and the `openedStation` event in `state.ts`, plus the `InventoryPanel` `craftingStation` prop) and **not** on `Recipe.station` — so `STATION_LABELS` (keyed off `Recipe.station`) needs no entry. The panel is a dedicated `*Column` component branched in before the recipe book in `InventoryPanel`, acting on the **selected hotbar slot** (`inventory[selectedHotbarSlot]`); its actions are new `Command`s in `commands.ts` handled in `GameEngine.dispatch` (gated on `state.craftingStation === <id>`), each emitting a one-shot event for the audio director. The block itself is **craft-only** (never generated), so adding the `BlockId` at the end of the enum needs **no `WORLDGEN_VERSION` bump** — just `BLOCK_COLORS` (atlas sizing), an atlas paint branch, the exhaustive `GROUP_BY_BLOCK`, and `BREAK_HARDNESS`/item-def/`BLOCK_TO_SLOT`/recipe.

## A container block (block-entity storage)

- Blocks are bare `BlockId`s, so any block that needs **attached data** (a chest's items) stores it in `state.containers: Map<voxelIndex, InventorySlot[]>`, keyed by `world.index(x,y,z)`. The chest is the reference:
  - **Open**: `interactChest` (an `INTERACTIVE_BLOCKS` branch) lazily creates the slot array, sets `state.openContainerIndex`, opens the inventory, and emits `openedContainer`. The snapshot exposes `container`, and `InventoryPanel` renders a second grid; `toggleInventory`/`pause` clear `openContainerIndex`.
  - **Move items**: the `moveStack` command swaps a slot across the inventory/chest boundary using the pure `inventory.moveStack` (chest indices offset by `CONTAINER_SLOT_BASE` in `commands.ts`).
  - **Place / break**: placing the block (`mining.placeSelectedBlock`) seeds an empty container; breaking it spills the contents into the inventory via `inventory.tryInsertSlots` (all-or-nothing — a break is refused with a `breakBlocked` event when they don't fit).
  - **Persist**: `serialize()` writes non-empty containers to `blockEntities` (`save.serializeContainers`); boot restores them (`save.readContainers`) only for indices that still hold the block. This is an **additive save bump** — see [save-format.md](save-format.md).

## A random-tick behavior (growth / spread)

- Block updates that happen "over time" run through `lib/game/engine/systems/randomTicks.ts`: every `RANDOM_TICK_INTERVAL_SECONDS` it samples `RANDOM_TICK_SAMPLES` columns within `RANDOM_TICK_RADIUS` of the player and runs a handler on each column's top block. Register a `BlockId → handler` in `RANDOM_TICK_HANDLERS`; the handler edits via `state.blockChanges` and sets `state.worldMeshDirty`.
- The crop handler is the reference: wheat stage ids are consecutive, so growth is `block + 1`, and the mature stage has no handler so it stops. Because crops are ordinary block edits, they persist for free via the save's block diff — no new save fields.
- Other handlers show the range: `growSapling` checks the block below (only soil matures a sapling) then calls the shared `growTreeAt` (`systems/treeGrowth.ts`); `spreadGrass` reads the four face-neighbour columns' top blocks to re-grass exposed dirt. Both ride `blockChanges`, so they need no save changes either.
- A growing block also needs the usual block plumbing — a `BlockId` (appended at the end of the enum so saved ids don't shift), `BLOCK_COLORS` + an atlas paint branch (plants reuse the wheat trick: a solid cube painted to read as a plant, so no new geometry), an exhaustive `GROUP_BY_BLOCK` sound entry, and `BREAK_HARDNESS`/`BLOCK_TO_SLOT`/`rollBlockDrops`. A new **material** item (e.g. bone meal) must also get an `ITEM_SPRITE_GRIDS` entry, or the sprite test fails its no-magenta-checker assertion.
- Tunables live in `config.ts`; the headless test pattern (a minimal `GameState`, a scripted rng that maps a sample onto a known column) is in `randomTicks.test.ts`. Watch the rng cadence: a handler that draws a variable number of times (e.g. a tree's trunk-height roll) shifts the sampler's `n % 3` pattern, so prefer an explicit sequence over `scriptedRng` for those.

## A transient (session-only) entity (projectile, bobber, …)

- Entities that exist only at runtime — arrows, thrown spears, the fishing bobber — live in `GameState` as session fields (an array with a `nextId` counter, or a single nullable field like `state.fishing`). They are **never serialized** (left out of `serialize()`), so they vanish on reload and must be cleared in `respawn()`.
- Spawn from the held-item action (e.g. `tryFish`/`tryThrowSelectedSpear` in their systems, wired into the `placeBlock`/`attack` precedence in `GameEngine.ts`), advance them in a per-frame `tick*` system called from `GameEngine.step`, and remove them on expiry/collision/cancel.
- Render by reading the field **directly from engine state** in `GameRenderer.sync` (the snapshot does not carry them) — add a `*Visuals` module mirroring `projectileVisuals.ts`/`bobberVisuals.ts` (create/sync/dispose, freeing its geometry/material). Because nothing is persisted, there is no save-format or worldgen impact.

## A worldgen structure (houses, dungeons, …)

- Structures are placed in `lib/world/generation.ts` at the end of the `generateWorld` pipeline. Mirror `placeHouse`/`placeDungeons`: loop a `GEN.<thing>Count`, sample positions, validate, and write blocks with `world.set`. Append your pass **last** so later passes don't overwrite it, and add the count to the frozen `GEN` object.
- **Any block write changes the deterministic output**, so this breaks the worldgen hash. Re-baseline the `generation.test.ts` digests and bump `WORLDGEN_VERSION` per the [testing.md](testing.md) policy (each world then discards its stale block-diffs and reboots from its seed); add a structural probe test (count your blocks, assert they generate) that survives the re-baseline.
- If the structure needs its positions known at runtime (dungeons re-derive chest/spawner indices on load, **villages** re-derive their centers to seed residents), expose a **derive pass** like `collectDungeonSites`/`collectVillageSites`: factor placement into a shared routine that either writes blocks or records indices, drawing from a **dedicated PRNG seeded only from `world.seed`** (`villageRand`) with a fixed number of draws per structure, and validate against **seed-pure** terrain (`terrainTopY`, `getBiome`) — never `highestSolidY`, which a cave or player edit can shift out from under the derive pass.
- **Villages** are the worked example of a structure that spawns mobs: `placeVillages` levels a small terrace and builds via the shared `buildHouseShell`, the engine seeds resident villagers at each `collectVillageSites` center, and those residents **persist** (they're `faction === "villager"`, so `isPersistentMob` keeps them) — so a structure's mobs only spawn when the world has none yet (a fresh world or a worldgen-upgrade), never on every reload.

## A loot table / lazy block-entity fill

- Drop tables are pure data + a roll function: copy the `{ itemId, min, max, chance? }` shape and the `clampUnit` roll loop from `lib/game/mobLoot.ts` / `lib/game/dungeonLoot.ts`. Add a `*.test.ts` asserting every `itemId` exists in `ITEM_DEFS` and that rolls are deterministic under an injected rng.
- To fill a **worldgen-placed** block-entity (a dungeon chest) whose contents can't live in the block-diff baseline: fill it lazily on first access, seeded from `world.seed ^ voxelIndex` (`dungeonLoot.seededRng`), and persist a set of _accessed_ indices (additive save field) — gate the fill on that set, **not** on whether the container is currently non-empty, or an emptied-then-reloaded entity re-rolls. `lib/game/engine/systems/dungeon.ts` (`fillDungeonChestIfUnlooted`), shared by the open and break paths, is the reference; see the exploit-guard test in `GameEngine.test.ts`.

## A status effect (timed buff / hazard)

- Effects live in `state.effects: Map<EffectId, number>` (id → remaining seconds), driven by `lib/game/engine/systems/statusEffects.ts`. Add an id to the `EffectId` union (`lib/game/types.ts`) and to `EFFECT_ORDER` + the `clearEffects`/helper logic; durations/strengths go in `config.ts`.
- **Apply it at one seam.** Each existing effect reads at exactly one place: Speed multiplies `playerMotion.ts` speed (`speedMultiplier`), Strength adds to the melee dispatch in `GameEngine.ts` (`strengthBonus`), Fire Resistance / Water Breathing are booleans passed into `tickLavaExposure`/`tickOxygen` (`playerStats.ts`), and Regeneration/Poison run inside `tickStatusEffects` on their **own** accumulators. Prefer a gate/modifier over a new tick; `tickStatusEffects` already runs after `tickHealthRegen` and before the environmental ticks, so its gates are current.
- **Damage that shouldn't kill** uses `applyNonLethalDamage` (`playerLife.ts`), not `applyUnmitigatedDamage` — poison floors at `POISON_FLOOR_HP`.
- **Grant it.** A drinkable potion is a `material` item with an `effect: { id, durationSeconds }` (`ItemDef`/`InventorySlot`); the `drinkPotion` command and the `F` key apply it via `addEffect`. A brewed potion is a `station: "brewing"` recipe (see "A new item or recipe"). A hazard source just calls `addEffect` (e.g. the rotten-flesh roll in the `eatFood` case, using the injected `this.rng`).
- **Show it.** Add a `HudIconName` + grid in `hudPixels.ts`; the cached `effectsProjection` in `GameEngine` feeds `GameSnapshot.activeEffects`, which `ActiveEffects.tsx` renders — keep the projection ref-stable (rebuild only when rounded seconds change) so the HUD doesn't thrash.
- **Persist it.** Effects are an **additive save bump** — see [save-format.md](save-format.md) (v6); they're cleared on death and `restoreEffects` validates them on load.

## An enchantment (per-item gear modifier)

- Enchantments are **per-item-instance data, like durability** — they live on the `InventorySlot`'s `enchantments` field (`{ id, level }[]`), driven by `lib/game/enchantments.ts`. Add an id to the `EnchantmentId` union (`types.ts`), list it in `ENCHANTMENT_DEFS` (applicable item kinds + max level) and `ENCHANTMENT_ORDER`, and put magnitudes in `config.ts`.
- **Bind to one item, not a whole kind**: an `ENCHANTMENT_DEFS` entry can carry an optional `itemIds` allow-list — when set, `canEnchant` also requires the slot's item id to be in it. This is how **Power/Punch** apply to the **bow** only and not to swords (which are `weapon` too). The seam reader is the same `enchantLevel(slot, id) × magnitude` shape; for the bow it's read in `tryFireBow` (`combat.ts`).
- **Read it at one seam**, the same as a status effect: add a reader (`sharpnessBonus`, `efficiencyMultiplier`, …) and call it where the value is computed — melee damage (the `GameEngine` attack dispatch), `equippedDefense`, `miningSpeed`, or the durability helpers (Unbreaking threads an optional `rng` into `consumeToolDurability`/`consumeEquippedArmorDurability` and returns `null`/unchanged to skip a point of wear).
- **Non-stackable for free**: enchantments only sit on durable gear, which is already stack-size 1 (`maxStackSizeForItem`), and `{ ...slot }` clones carry the field through every inventory move.
- **Apply it** with the `enchant` command (gated on an open enchanting table): `canEnchant` (kind + level cap) → `spendXpLevels` → immutable `applyEnchant`. The `EnchantingColumn` panel renders the options for the selected hotbar item.
- **Persist it**: enchantments are an **additive save field** on `SavedSlot` — see [save-format.md](save-format.md) (v7); `restoreSlot` validates them on load (known ids, clamped levels, durable gear only).

## An advancement / a stat

Progression meta lives in one declarative module, `lib/game/engine/systems/advancements.ts`, hooked to the single `GameEngine.emit` chokepoint — so you never edit per-system files.

- **A new statistic.** In `recordEvent`, map the relevant `GameEvent` to a counter with `bump(state, "<stat_id>")` (one `Map<string, number>` on `GameState.stats`); for a tick-driven total use `recordTick`. To surface it on the Statistics tab, add a `{ id, label, format }` row to `STATS` (`format` is `"count" | "distance" | "duration"`). The id set is open — no allow-list to touch. If the event you need doesn't exist yet, emit a new one (the `crafted` event was added this way); every emit flows through the observer.
- **A new advancement.** Add a row to the `ADVANCEMENTS` registry: `{ id, title, description, icon, category, stat, threshold }`. Unlock is uniform (`state.stats.get(stat) >= threshold`), so there's **no logic** — pick (or add) the `stat` it keys on and a `category` from `ADVANCEMENT_CATEGORY_ORDER`. `icon` is any existing item/block id (rendered via `itemIconUrl` — **zero new assets**; verify it renders). The engine's `observeProgress` auto-unlocks it, fires the `advancementUnlocked` toast + chime, and `AdvancementsPanel` shows it.
- **Persist it.** `stats` and `advancements` are **additive save fields** — see [save-format.md](save-format.md) (v13). Both are kept across death (like `xp`, unlike `effects`); `restoreStats`/`restoreAdvancements` validate them on load. No new field is needed for a stat or advancement that keys on existing counters.
- **Reuse lookups.** Counting hostile kills reads `HOSTILE_MOB_KINDS` (`lib/game/mobs.ts`), the single source of truth (hostility isn't on `MOB_TEMPLATES`) — reuse such a table rather than re-deriving it.

## A new mechanic

Add a system module under `lib/game/engine/systems/` (a function over `GameState`), give it a slot in the `GameEngine.step` sequence, and put its tunables in `lib/game/config.ts`. If the UI triggers it, add a `Command` variant. Write its headless test next to it.
