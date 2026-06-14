# Gameplay Reference

Scannable tables for everything in the game: recipes, blocks, mobs, and item
stats. For how it all fits together, read the [player manual](manual.md).

> **The code is the source of truth.** These tables are a convenience snapshot of
> `lib/game/recipes.ts`, `lib/game/items.ts`, `lib/world/blocks.ts`,
> `lib/game/mobs.ts`, and `lib/game/mobLoot.ts`. If a number here disagrees with
> the game, the code wins — and this page needs an update.

## Recipes

**40 recipes.** All use the always-available crafting grid except the two
**furnace** smelting recipes, which need an open furnace.

### Building & materials

| Result      | Ingredients       |
| ----------- | ----------------- |
| 4 Planks    | 2 Wood            |
| 2 Glass     | 4 Sand            |
| 2 Brick     | 2 Dirt + 2 Stone  |
| 1 Furnace   | 8 Cobble          |
| 1 Chest     | 8 Planks          |
| 1 Wood Door | 6 Planks          |
| 1 Bed       | 3 Wool + 3 Planks |
| 1 Wool      | 4 String          |

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

| Result         | Ingredients             |
| -------------- | ----------------------- |
| Knife          | 1 Stone + 1 Wood        |
| Wood Sword     | 2 Planks + 1 Wood       |
| Stone Sword    | 2 Cobble + 1 Wood       |
| Sliver Sword   | 2 Sliver Ore + 1 Wood   |
| Ruby Sword     | 2 Ruby Ore + 1 Wood     |
| Sapphire Sword | 2 Sapphire Ore + 1 Wood |
| Gold Sword     | 2 Gold Ore + 1 Wood     |
| Diamond Sword  | 2 Diamond Ore + 1 Wood  |
| Wood Spear     | 1 Planks + 2 Wood       |
| Stone Spear    | 1 Cobble + 2 Wood       |
| Sliver Spear   | 1 Sliver Ore + 2 Wood   |
| Ruby Spear     | 1 Ruby Ore + 2 Wood     |
| Sapphire Spear | 1 Sapphire Ore + 2 Wood |
| Gold Spear     | 1 Gold Ore + 2 Wood     |
| Diamond Spear  | 1 Diamond Ore + 2 Wood  |

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

| Result         | Ingredients            | Station |
| -------------- | ---------------------- | ------- |
| Bread          | 3 Wheat                | —       |
| Cooked Chicken | Raw Chicken + 1 Planks | Furnace |
| Cooked Mutton  | Raw Mutton + 1 Planks  | Furnace |

## Blocks

**28 block types** (plus air). Hardness is relative break time — higher is slower.
"Mine with" is the minimum tool needed; blocks with no requirement break with bare
hands or any tool. Bedrock and water cannot be broken.

| Block             | Hardness | Mine with      | Notes                                                                                                         |
| ----------------- | -------- | -------------- | ------------------------------------------------------------------------------------------------------------- |
| Grass             | 2        | any            | Drops dirt; ~20% chance to also drop a seed                                                                   |
| Dirt              | 2        | any            | —                                                                                                             |
| Sand              | 2        | any            | Common on beaches and in deserts                                                                              |
| Snow              | 2        | any            | Mountain peaks                                                                                                |
| Leaves            | 2        | any            | From trees; drops dirt                                                                                        |
| Cactus            | 2        | any            | Desert decoration                                                                                             |
| Glass             | 2        | any            | Crafted from sand; clear when placed                                                                          |
| Wood              | 3        | any            | Tree trunks                                                                                                   |
| Planks            | 3        | any            | Crafted from wood                                                                                             |
| Stone             | 5        | Wood Pickaxe   | Drops the stone item                                                                                          |
| Cobblestone       | 5        | Wood Pickaxe   | Drops cobble (crafting staple)                                                                                |
| Brick             | 5        | Wood Pickaxe   | Crafted; also found in houses                                                                                 |
| Furnace           | 5        | Wood Pickaxe   | **Interactive** — opens smelting recipes                                                                      |
| Chest             | 3        | any            | **Interactive** — 27-slot storage; breaking it spills the contents into your inventory (refused if it's full) |
| Wood Door         | 3        | any            | **Interactive** — thin 1×2 panel; right-click to open/close; mobs cannot operate it                           |
| Sliver Ore        | 7        | Stone Pickaxe  | —                                                                                                             |
| Ruby Ore          | 9        | Sliver Pickaxe | —                                                                                                             |
| Gold Ore          | 11       | Sliver Pickaxe | —                                                                                                             |
| Sapphire Ore      | 12       | Ruby Pickaxe   | —                                                                                                             |
| Diamond Ore       | 14       | Ruby Pickaxe   | Deepest, rarest ore                                                                                           |
| Bed               | 2        | any            | **Interactive** — sleep & set spawn                                                                           |
| Farmland          | 1        | any            | Tilled soil; reverts to dirt when broken                                                                      |
| Wheat (stage 0–2) | 1        | any            | Immature crop; drops its seed                                                                                 |
| Wheat (stage 3)   | 1        | any            | Mature crop; drops wheat + 1–2 seeds                                                                          |
| Bedrock           | —        | unbreakable    | World floor and border                                                                                        |
| Water             | —        | —              | Liquid; place blocks into it to replace cells; 60 s continuous immersion starts 1.5-heart damage each second  |

## Mobs

**6 mob kinds.** Passive animals flee but never attack and can be bred; hostiles
hunt at night. Drop counts are inclusive ranges rolled per kill.

| Mob      | Type    | HP  | Speed | Detect range | Attack | Cooldown | Drops                      |
| -------- | ------- | --- | ----- | ------------ | ------ | -------- | -------------------------- |
| Sheep    | passive | 10  | 0.9   | —            | —      | —        | 1–2 Wool, 1 Raw Mutton     |
| Chicken  | passive | 7   | 1.2   | —            | —      | —        | 0–2 Feather, 1 Raw Chicken |
| Horse    | passive | 14  | 1.4   | —            | —      | —        | 1–2 Leather                |
| Zombie   | hostile | 10  | 1.05  | 11           | 3      | 1.35 s   | 1–2 Rotten Flesh           |
| Skeleton | hostile | 9   | 1.08  | 12           | 3      | 1.4 s    | 1–2 Bone                   |
| Spider   | hostile | 8   | 1.2   | 10           | 2      | 1.1 s    | 0–2 String                 |

Spiders are hostile only in the dark (daylight below 0.42); in twilight and day
they behave like passives. **Breeding:** feed wheat to a sheep or horse, or seeds
to a chicken; babies grow up in ~90 s. Passive population is capped at 24, hostiles
at 16.

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
| Wood Spear     | 11    | 15    | 70         |
| Stone Spear    | 16    | 21    | 140        |
| Sliver Spear   | 22    | 28    | 230        |
| Ruby Spear     | 29    | 36    | 330        |
| Sapphire Spear | 33    | 41    | 420        |
| Gold Spear     | 38    | 47    | 500        |
| Diamond Spear  | 45    | 55    | 680        |

All durable gear is non-stackable: armor, tools, knives, swords, and spears each
occupy one inventory or chest slot.

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

| Item           | Hunger restored | Source             |
| -------------- | --------------- | ------------------ |
| Cooked Chicken | 8               | Smelt raw chicken  |
| Cooked Mutton  | 8               | Smelt raw mutton   |
| Food           | 7               | Generic food item  |
| Bread          | 6               | Craft from 3 wheat |
| Raw Chicken    | 3               | Chicken drop       |
| Raw Mutton     | 3               | Sheep drop         |
| Rotten Flesh   | 2               | Zombie drop        |

### Materials

Crafting ingredients with no direct use on their own: **Wool**, **Feather**,
**Bone**, **Leather**, **String** (mob drops), and **Wheat Seeds** / **Wheat**
(from farming and grass).
