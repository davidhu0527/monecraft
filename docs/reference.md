# Gameplay Reference

Scannable tables for everything in the game: recipes, blocks, mobs, and item
stats. For how it all fits together, read the [player manual](manual.md).

> **The code is the source of truth.** These tables are a convenience snapshot of
> `lib/game/recipes.ts`, `lib/game/items.ts`, `lib/world/blocks.ts`,
> `lib/game/mobs.ts`, and `lib/game/mobLoot.ts`. If a number here disagrees with
> the game, the code wins — and this page needs an update.

## World types

Chosen when you create a world (alongside the name and seed) and fixed for its
life. All four share the same five biomes — they reshape terrain, not the biome
mix. Source: `lib/world/worldTypes.ts` + `terrainConfigFor` in `lib/world/generation.ts`.

| Type      | Terrain                                                                                     |
| --------- | ------------------------------------------------------------------------------------------- |
| Default   | Balanced terrain with every biome — the original generator                                  |
| Superflat | Level ground at a fixed height; a builder's canvas (caves and ores still generate below)    |
| Amplified | Exaggerated relief — towering peaks and deep valleys                                        |
| Islands   | A raised sea breaks the land into scattered, gently sloped islands with deep ocean channels |

## Recipes

**55 crafting recipes** (plus **10 villager trades**, listed under [Trading](#trading)).
All use the always-available crafting grid except the nine **furnace** smelting
recipes, which need an open furnace.

In-game, the recipe book groups recipes into the sections below (Tools, Weapons,
Armor, Building, Food, Materials, then Smelting and Trades), listing the recipes you
can currently afford first within each section.

### Building & materials

| Result      | Ingredients          |
| ----------- | -------------------- |
| 4 Planks    | 2 Wood               |
| 2 Glass     | 4 Sand               |
| 2 Brick     | 2 Dirt + 2 Stone     |
| 1 Furnace   | 8 Cobble             |
| 1 Chest     | 8 Planks             |
| 1 Wood Door | 6 Planks             |
| 4 Torch     | 1 Coal + 1 Wood      |
| 1 Bed       | 3 Wool + 3 Planks    |
| 1 Wool      | 4 String             |
| 1 TNT       | 4 Gunpowder + 1 Sand |
| 3 Bone Meal | 1 Bone               |

### Tools

| Result           | Ingredients             |
| ---------------- | ----------------------- |
| Wood Hoe         | 2 Planks + 1 Wood       |
| Wood Pickaxe     | 2 Planks + 2 Wood       |
| Stone Pickaxe    | 2 Cobble + 1 Wood       |
| Sliver Pickaxe   | 2 Sliver Ore + 1 Wood   |
| Ruby Pickaxe     | 2 Ruby Ore + 1 Wood     |
| Sapphire Pickaxe | 2 Sapphire Ore + 1 Wood |
| Gold Pickaxe     | 2 Gold Ore + 1 Wood     |
| Diamond Pickaxe  | 2 Diamond Ore + 1 Wood  |

### Weapons

| Result         | Ingredients                    |
| -------------- | ------------------------------ |
| Knife          | 1 Stone + 1 Wood               |
| Wood Sword     | 2 Planks + 1 Wood              |
| Stone Sword    | 2 Cobble + 1 Wood              |
| Sliver Sword   | 2 Sliver Ore + 1 Wood          |
| Ruby Sword     | 2 Ruby Ore + 1 Wood            |
| Sapphire Sword | 2 Sapphire Ore + 1 Wood        |
| Gold Sword     | 2 Gold Ore + 1 Wood            |
| Diamond Sword  | 2 Diamond Ore + 1 Wood         |
| Dragon Sword   | 1 Dragon Heart + 2 Diamond Ore |
| Wood Spear     | 1 Planks + 2 Wood              |
| Stone Spear    | 1 Cobble + 2 Wood              |
| Sliver Spear   | 1 Sliver Ore + 2 Wood          |
| Ruby Spear     | 1 Ruby Ore + 2 Wood            |
| Sapphire Spear | 1 Sapphire Ore + 2 Wood        |
| Gold Spear     | 1 Gold Ore + 2 Wood            |
| Diamond Spear  | 1 Diamond Ore + 2 Wood         |

### Ranged & endgame

| Result       | Ingredients                         |
| ------------ | ----------------------------------- |
| Bow          | 3 Wood + 3 String                   |
| Arrow (×4)   | 1 Stone + 1 Wood + 1 Feather        |
| Cursed Totem | 1 Diamond Ore + 2 Bone + 2 Gold Ore |

### Armor

| Result          | Ingredients                 |
| --------------- | --------------------------- |
| Helmet          | 4 Sapphire Ore + 1 Ruby Ore |
| Face Mask       | 2 Ruby Ore + 2 Sapphire Ore |
| Neck Protection | 2 Gold Ore + 1 Sapphire Ore |
| Chestplate      | 5 Gold Ore + 2 Sapphire Ore |
| Leggings        | 4 Gold Ore + 2 Ruby Ore     |
| Boots           | 2 Sapphire Ore + 2 Gold Ore |

### Food & smelting

"Fuel" is coal or charcoal (interchangeable). Charcoal is smelted from wood, so a
player who hasn't found coal can still cook.

| Result          | Ingredients         | Station |
| --------------- | ------------------- | ------- |
| Bread           | 3 Wheat             | —       |
| Charcoal        | 1 Wood              | Furnace |
| Cooked Chicken  | Raw Chicken + Fuel  | Furnace |
| Cooked Mutton   | Raw Mutton + Fuel   | Furnace |
| Cooked Beef     | Raw Beef + Fuel     | Furnace |
| Cooked Porkchop | Raw Porkchop + Fuel | Furnace |

## Blocks

**33 block types** (plus air). Hardness is relative break time — higher is slower.
"Mine with" is the minimum tool needed; blocks with no requirement break with bare
hands or any tool. Bedrock, water, and lava cannot be broken.

| Block             | Hardness | Mine with       | Notes                                                                                                                 |
| ----------------- | -------- | --------------- | --------------------------------------------------------------------------------------------------------------------- |
| Grass             | 2        | any             | Drops dirt; ~20% chance to also drop a seed                                                                           |
| Dirt              | 2        | any             | —                                                                                                                     |
| Sand              | 2        | any             | Common on beaches and in deserts                                                                                      |
| Snow              | 2        | any             | Mountain peaks                                                                                                        |
| Leaves            | 2        | any             | From trees; drops a sapling ~8% of the time, else nothing                                                             |
| Cactus            | 2        | any             | Desert decoration                                                                                                     |
| Glass             | 2        | any             | Crafted from sand; clear when placed                                                                                  |
| Wood              | 3        | any             | Tree trunks                                                                                                           |
| Planks            | 3        | any             | Crafted from wood                                                                                                     |
| Stone             | 5        | Wood Pickaxe    | Drops the stone item                                                                                                  |
| Cobblestone       | 5        | Wood Pickaxe    | Drops cobble (crafting staple)                                                                                        |
| Brick             | 5        | Wood Pickaxe    | Crafted; also found in houses                                                                                         |
| Furnace           | 5        | Wood Pickaxe    | **Interactive** — opens smelting recipes                                                                              |
| Chest             | 3        | any             | **Interactive** — 27-slot storage; breaking it spills the contents into your inventory (refused if it's full)         |
| Wood Door         | 3        | any             | **Interactive** — thin 1×2 panel; right-click to open/close; mobs cannot operate it                                   |
| Torch             | 1        | any             | Place it to light the dark; emits block light 14. Crafted 4-at-a-time from 1 coal + 1 wood                            |
| TNT               | 1        | any             | **Interactive** — right-click with a torch to light a fuse, then it explodes (power 4). Crafted from gunpowder + sand |
| Lava              | —        | (unbreakable)   | Glows in the deepest caves; **burns on contact** (3 hearts / 0.5 s, armor-bypassing). Worldgen-only, no item          |
| Mossy Cobblestone | 5        | Wood Pickaxe    | Dungeon walls; mineable into a `mossy_cobble` item (found-only, no recipe)                                            |
| Spawner           | 30       | (unbreakable\*) | Dungeon-only; drips hostiles when you're near. Very hard and drops nothing — mining it out just stops it              |
| Coal Ore          | 6        | Wood Pickaxe    | Shallow and common; drops the `coal` fuel item (not a placeable block)                                                |
| Sliver Ore        | 7        | Stone Pickaxe   | —                                                                                                                     |
| Ruby Ore          | 9        | Sliver Pickaxe  | —                                                                                                                     |
| Gold Ore          | 11       | Sliver Pickaxe  | —                                                                                                                     |
| Sapphire Ore      | 12       | Ruby Pickaxe    | —                                                                                                                     |
| Diamond Ore       | 14       | Ruby Pickaxe    | Deepest, rarest ore                                                                                                   |
| Bed               | 2        | any             | **Interactive** — sleep & set spawn                                                                                   |
| Farmland          | 1        | any             | Tilled soil; reverts to dirt when broken                                                                              |
| Wheat (stage 0–2) | 1        | any             | Immature crop; drops its seed                                                                                         |
| Wheat (stage 3)   | 1        | any             | Mature crop; drops wheat + 1–2 seeds                                                                                  |
| Sapling           | 1        | any             | Plant on grass/dirt; grows into a tree over time (or instantly with bone meal). Drops itself                          |
| Bedrock           | —        | unbreakable     | World floor and border                                                                                                |
| Water             | —        | —               | Liquid; place blocks into it to replace cells; 60 s continuous immersion starts 1.5-heart damage each second          |

## Mobs

**10 mob kinds** (plus the summoned boss). Passive animals flee but never attack and
can be bred; the villager is passive but doesn't flee (right-click to trade); hostiles
hunt at night. Drop counts are inclusive ranges rolled per kill.

| Mob      | Type    | HP   | Speed | Detect range | Attack             | Cooldown | Drops                           |
| -------- | ------- | ---- | ----- | ------------ | ------------------ | -------- | ------------------------------- |
| Sheep    | passive | 10   | 0.9   | —            | —                  | —        | 1–2 Wool, 1 Raw Mutton          |
| Chicken  | passive | 7    | 1.2   | —            | —                  | —        | 0–2 Feather, 1 Raw Chicken      |
| Horse    | passive | 14   | 1.4   | —            | —                  | —        | 1–2 Leather                     |
| Cow      | passive | 10   | 0.9   | —            | —                  | —        | 1–2 Leather, 1 Raw Beef         |
| Pig      | passive | 8    | 1.0   | —            | —                  | —        | 1 Raw Porkchop                  |
| Villager | passive | 20   | 0.6   | —            | — (trade partner)  | —        | nothing                         |
| Zombie   | hostile | 100  | 1.05  | 11           | 3                  | 1.35 s   | 1–2 Rotten Flesh                |
| Skeleton | hostile | 100  | 1.08  | 12           | arrow (4)          | 1.8 s    | 1–2 Bone                        |
| Spider   | hostile | 100  | 1.2   | 10           | 2                  | 1.1 s    | 0–2 String                      |
| Creeper  | hostile | 100  | 1.0   | 12           | explodes (power 3) | —        | 1–2 Gunpowder                   |
| Boss     | hostile | 1000 | 1.1   | 28           | 10 melee / 7 arrow | 1.5 s    | 1 Dragon Heart, 2–4 Diamond Ore |

### Trading

Right-click a **villager** to open its trades (the recipe book switches to a
**Trading** panel). The currency is the **emerald**: sell gathered materials for
emeralds, then spend them on goods. No use caps — trading is bounded only by what
you can gather. Trades live in `lib/game/trades.ts`.

| Trade             | Give       | Get             |
| ----------------- | ---------- | --------------- |
| Sell wheat        | 6 Wheat    | 1 Emerald       |
| Sell coal         | 3 Coal     | 1 Emerald       |
| Sell leather      | 2 Leather  | 1 Emerald       |
| Sell gold ore     | 1 Gold Ore | 1 Emerald       |
| Buy bread         | 1 Emerald  | 2 Bread         |
| Buy torches       | 1 Emerald  | 8 Torch         |
| Buy arrows        | 2 Emerald  | 8 Arrow         |
| Buy stone pickaxe | 3 Emerald  | 1 Stone Pickaxe |
| Buy sliver ore    | 5 Emerald  | 1 Sliver Ore    |
| Buy ruby ore      | 8 Emerald  | 1 Ruby Ore      |

Skeletons are now **ranged** — they kite and fire arrows instead of meleeing.
**Creepers** chase silently, then light a ~1.5 s fuse when they get within ~2.6
blocks (hissing and swelling) and **explode**, cratering terrain and hurting
everything nearby; walk away while it is primed and the fuse aborts. Kill one
before it detonates to claim its gunpowder safely. Hostiles never spawn within 16
blocks of you, so nothing materializes point-blank.
Spiders are hostile only in the dark (daylight below 0.42); in twilight and day
they behave like passives. **Breeding:** feed wheat to a sheep, horse, or cow, or
seeds to a chicken or pig; babies grow up in ~90 s. Passive population is capped at
24, hostiles at 16.

The **Boss** is summoned, not spawned (see [Endgame](#endgame)): it bears down on
you, melees up close, fires a 3-arrow spread at range, summons minions, and is
immune to the daylight burn.

## Items

### Tools

`minePower` scales break speed; `tier` gates which ore a pickaxe can harvest
(stone/cobble/brick ≥ 1, sliver ≥ 2, ruby & gold ≥ 3, sapphire & diamond ≥ 4).

| Item             | Mine power | Tier | Durability |
| ---------------- | ---------- | ---- | ---------- |
| Wood Hoe         | 1.0        | 0    | 90         |
| Wood Pickaxe     | 1.05       | 1    | 70         |
| Stone Pickaxe    | 1.55       | 2    | 140        |
| Sliver Pickaxe   | 2.2        | 3    | 240        |
| Ruby Pickaxe     | 2.8        | 4    | 340        |
| Sapphire Pickaxe | 3.3        | 5    | 430        |
| Gold Pickaxe     | 3.8        | 6    | 520        |
| Diamond Pickaxe  | 4.4        | 7    | 700        |

### Weapons

A bare fist deals 6 damage for comparison. Spears have 7-block melee reach
(other attacks: 4.5) and can be thrown with right-click/`E`. Thrown spears fly
quickly with a shallow arc; misses remain stuck in terrain for 2 seconds.

| Item           | Melee | Throw | Durability |
| -------------- | ----- | ----- | ---------- |
| Knife          | 9     | —     | 50         |
| Wood Sword     | 13    | —     | 80         |
| Stone Sword    | 18    | —     | 160        |
| Sliver Sword   | 24    | —     | 260        |
| Ruby Sword     | 31    | —     | 360        |
| Sapphire Sword | 35    | —     | 450        |
| Gold Sword     | 40    | —     | 540        |
| Diamond Sword  | 47    | —     | 720        |
| Dragon Sword   | 60    | —     | 1200       |
| Wood Spear     | 11    | 15    | 70         |
| Stone Spear    | 16    | 21    | 140        |
| Sliver Spear   | 22    | 28    | 230        |
| Ruby Spear     | 29    | 36    | 330        |
| Sapphire Spear | 33    | 41    | 420        |
| Gold Spear     | 38    | 47    | 500        |
| Diamond Spear  | 45    | 55    | 680        |
| Bow            | —     | —     | 200        |

The **Bow** does no melee damage; holding it makes the attack input fire an arrow
(`BOW_ARROW_DAMAGE`, 9) per click on a short cooldown, spending one arrow and a
point of durability. The **Dragon Sword** is the best-in-game melee weapon,
craftable only from the boss's Dragon Heart drop. All durable gear is
non-stackable: armor, tools, knives, swords, spears, and the bow each occupy one
inventory or chest slot.

### Armor

Each piece occupies its own equip slot. Defense reduces incoming damage (a hit
always deals at least 1).

| Item            | Slot            | Defense | Durability |
| --------------- | --------------- | ------- | ---------- |
| Helmet          | helmet          | 2       | 260        |
| Face Mask       | face_mask       | 2       | 220        |
| Neck Protection | neck_protection | 2       | 230        |
| Chestplate      | chestplate      | 4       | 420        |
| Leggings        | leggings        | 3       | 340        |
| Boots           | boots           | 2       | 250        |

### Food

`Eat` (`F`) restores the listed hunger.

| Item            | Hunger restored | Source             |
| --------------- | --------------- | ------------------ |
| Cooked Chicken  | 8               | Smelt raw chicken  |
| Cooked Mutton   | 8               | Smelt raw mutton   |
| Cooked Beef     | 8               | Smelt raw beef     |
| Cooked Porkchop | 8               | Smelt raw porkchop |
| Food            | 7               | Generic food item  |
| Bread           | 6               | Craft from 3 wheat |
| Raw Chicken     | 3               | Chicken drop       |
| Raw Mutton      | 3               | Sheep drop         |
| Raw Beef        | 3               | Cow drop           |
| Raw Porkchop    | 3               | Pig drop           |
| Rotten Flesh    | 2               | Zombie drop        |

### Materials

Crafting ingredients with no direct use on their own: **Wool**, **Feather**,
**Bone**, **Leather**, **String** (mob drops), and **Wheat Seeds** / **Wheat**
(from farming and grass). **Bone Meal** (ground from a bone, 1 → 3) is a
fertilizer: right-click it on a sapling to grow the tree instantly, or on
immature wheat to advance it 1–2 stages. Fuels: **Coal** (mined from coal ore)
and **Charcoal** (smelted from wood) — interchangeable for smelting and torches.
**Gunpowder** (creeper drop) crafts TNT. **Emerald** is the villager [trading](#trading) currency.
Ranged/endgame materials: **Arrow** (bow ammo),
**Cursed Totem** (right-click to summon the boss), and **Dragon Heart** (the
boss drop that crafts the Dragon Sword).

## Dungeons

Small cobblestone rooms (speckled with mossy cobble) generate **underground**,
well clear of the spawn area. Each holds 1–2 **loot chests** and a central **mob
spawner**. The loot tables live in `lib/game/dungeonLoot.ts`; a chest fills on
first open or break, with loot seeded so it's the same until you reach it.

Each chest rolls a tier:

| Tier   | Odds | Contents                                                                                                                      |
| ------ | ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| Common | 75%  | Bone (always), bread, cooked chicken, string, seeds, sliver/gold ore, an occasional stone pickaxe                             |
| Rare   | 25%  | Everything a common chest rolls **plus** diamond/sapphire ore, a ruby/sapphire sword, helmet/chestplate, rare diamond pickaxe |

**Spawners** are time-independent: while you're within ~16 blocks, a spawner
drips one hostile (zombie/skeleton/spider) every ~8 s onto the room floor, up to
6 clustered nearby (and never past the global hostile cap of 16). Mining the
spawner block out stops it.

## Endgame

Craft a **Cursed Totem** (1 diamond ore + 2 bone + 2 gold ore) and right-click
it in the open to summon the **Boss** nearby (refused if one already walks). The
fight is meant to test full diamond gear plus a bow:

- It approaches and **bites** for 10 up close, looses a **3-arrow spread** for 7
  each at range, and periodically **summons** a skeleton or zombie (up to 4, under
  the global cap). It has **1000 HP** and does not burn in daylight.
- Every hostile shows a health bar above its head. The boss also has a
  top-of-screen health bar while it lives.
- Defeating it drops a **Dragon Heart** (+ 2–4 diamond ore), shows a one-time
  **victory screen**, and lets you craft the **Dragon Sword** (60 attack). You
  keep playing afterward; another totem summons it again.
