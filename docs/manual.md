# Player Manual

A complete guide to playing Monecraft — a single-player, browser-based voxel
sandbox. Mine, build, craft, farm, fight off the night, and survive.

This page is the prose guide; for the exact numbers (every recipe, block, mob, and
item stat) see the [reference tables](reference.md). Just want the keys? They're in
the [README](../README.md#controls).

> Everything you see and hear is generated from code at runtime — there are no
> image or audio files anywhere in the game.

## Getting started: your first day

You spawn at dawn on solid ground with a small starter kit: stacks of grass, dirt,
stone, wood, planks, cobble, and sand, plus a **wood pickaxe** and a **knife**.

The day-night cycle is short — **four minutes per full day** — so the first night
comes fast. A good opening:

1. **Look around.** Click the game once to lock the mouse (the first click only
   grabs the pointer; it doesn't mine). Move with `W A S D`, look with the mouse.
2. **Gear up from your kit.** Open the inventory with **`I`**. You already have
   cobble and wood, so craft a **stone pickaxe** (2 cobble + 1 wood) and a **stone
   sword** (2 cobble + 1 wood) — both upgrades over your starting wood pickaxe and
   knife.
3. **Mine and gather.** Hold **left-click** to break trees, stone, and dirt for
   more materials; craft **2 wood → 4 planks** whenever you need them.
4. **Shelter before dark.** Wall yourself in with blocks (**right-click** or `E`
   to place the selected hotbar item), or craft a **bed** and skip the night
   entirely. Hostile mobs spawn once it gets dark, so don't be caught in the open.

From there it's a sandbox: dig for ores, build, farm, breed animals, and gear up.

## Controls

| Key / input        | Action                                                                |
| ------------------ | --------------------------------------------------------------------- |
| `W` `A` `S` `D`    | Move (walk / strafe)                                                  |
| `Space`            | Jump                                                                  |
| `C`                | Crouch (slower, careful movement)                                     |
| `W` + `CapsLock`   | Sprint — faster, but drains hunger                                    |
| Mouse              | Look around (click the game first to lock the pointer)                |
| Left-click (hold)  | Break the targeted block / attack a mob                               |
| Right-click or `E` | Place the selected block / interact (bed, furnace, chest, hoe, seeds) |
| `1`–`9`            | Select a hotbar slot                                                  |
| `I`                | Open / close inventory & crafting                                     |
| `F`                | Eat the selected food                                                 |
| `V`                | Cycle camera: first-person → third-person rear → third-person front   |
| `U`                | Emergency unstuck (teleport to safe ground if wedged)                 |
| `Esc`              | Pause menu (save / load / reset, volume sliders, skin picker)         |
| `F3`               | Debug overlay (FPS, position, daylight, mob counts)                   |

Gameplay is always **eye-relative**: even in third person, your reach, aim, and
audio follow where your eyes point, and the crosshair stays centered.

## Survival

### Health and death

You have **20 health**, shown as **10 hearts** (each heart = 2 HP). Mobs, falling
into the void, and starvation-adjacent danger chip it away. At zero health you die,
freeze for **3 seconds**, then respawn — at your bed if you've slept in one,
otherwise at a random land point. Death doesn't wipe your world or inventory.

If you ever get wedged inside terrain, press **`U`** to teleport free. (Standing in
water is _not_ "stuck" — you're allowed to swim.)

### Hunger

You have **20 hunger**, shown as **10 drumsticks**. Activity burns it:

- ~1 hunger per **100 blocks sprinted**
- ~1 hunger per **300 blocks walked**
- ~1 hunger per **50 jumps**

Hunger gates two things:

- **Sprinting** needs hunger above **6** — below that you slow down.
- **Health regeneration** only runs while hunger is **12 or higher**: you heal
  about **+0.5 HP every 3 seconds** when you're fed and hurt.

So eat before a fight. Press **`F`** to eat the selected food. Different foods
restore different amounts — cooked meat fills far more than raw (see the
[food table](reference.md#food)).

### Combat

Hold **left-click** to swing. You hit a mob if it's within **~4.5 blocks** and
close to your crosshair (a fairly tight aim cone). Bare fists do **6 damage**;
weapons do much more and have durability that ticks down with each hit. A landed
blow knocks the mob back.

**Armor** reduces incoming damage. Equip a helmet, face mask, neck protection,
chestplate, leggings, and boots from the inventory's armor slots. Each piece adds
defense and absorbs durability when you're struck — but a hit always deals at
least **1 damage**, even in a full set.

## Day, night, and danger

A full day lasts **240 seconds (4 minutes)**. Daylight rises and falls on a smooth
curve from ~0.04 at midnight to ~1.0 at noon. Three thresholds matter:

| Daylight       | What happens                                                              |
| -------------- | ------------------------------------------------------------------------- |
| below **0.28** | Night: hostile mobs spawn, and you may sleep                              |
| below **0.42** | Spiders turn hostile (they're passive in twilight and day)                |
| above **0.72** | Hostile mobs caught in open sunlight catch fire and burn (caves are safe) |

The game boots at a dim dawn, so the very first mobs can already be active —
build or sleep quickly.

**Weather and sky.** It periodically **rains** — or **snows** up in the mountains —
with clouds rolling in, the sky greying over, and the light dimming; deserts and
oceans stay clear. At night the sky fills with **stars and a moon**, while clouds
drift overhead by day. Weather is atmospheric only: it doesn't change how mobs
spawn or behave, and it isn't saved.

## Mining and building

**Break** a block by holding left-click; a crack overlay shows progress, and harder
blocks take longer. **Place** the selected hotbar item with right-click (or `E`)
against a surface. Your reach is about **7 blocks**.

**Tools gate what you can mine.** A pickaxe's tier determines which blocks it can
harvest at all — mining with too weak a tool yields nothing:

| To mine…                  | You need at least… |
| ------------------------- | ------------------ |
| Stone, cobblestone, brick | Wood pickaxe       |
| Sliver ore                | Stone pickaxe      |
| Ruby & gold ore           | Sliver pickaxe     |
| Sapphire & diamond ore    | Ruby pickaxe       |

Higher-tier pickaxes (sapphire, gold, diamond) also mine **faster**. Dirt, sand,
wood, leaves, and crops need no special tool. Ores hide underground and in caves;
the rarer the ore, the deeper it tends to sit.

## Dungeons and loot

Digging around underground can turn up a **dungeon**: a small cobblestone room,
flecked with mossy cobble, sealed in the rock away from your spawn. Inside are
**loot chests** — open them for a free haul of food, ores, and sometimes real
gear (a sword, armor, even a diamond pickaxe if you're lucky). Each chest's loot
is fixed until you reach it, and once you've opened (or broken) it, it won't
refill — so there's no farming the same chest twice.

The catch: most dungeons hold a **spawner**, a dark caged block that conjures a
hostile every few seconds as long as you're standing near it. They keep coming
until you back off — or **mine the spawner block out**, which shuts it down for
good (it's tough and drops nothing). Grab the loot, deal with the mob, and leave,
or clear the spawner first if you want to loot in peace.

## Crafting

Open the inventory (`I`) to reach the crafting panel. Pick a recipe whose
ingredients you have and craft it — the result drops into your inventory (crafting
is refused if there's no room rather than destroying the overflow). Stacks hold up
to **99** items; tools, weapons, and armor take one slot each and show durability.

The basic recipe grid is always available. **Smelting** recipes (cooking raw meat)
require a **furnace**: craft one from 8 cobble, place it, and right-click it to open
the panel in furnace mode — the cooking recipes unlock while a furnace is open and
show as "Requires Furnace" otherwise.

See the full list of **32 recipes** in the [reference](reference.md#recipes).

## Storage

Your pack only holds 36 slots, so build **chests** to stash the overflow. Craft a
chest from **8 planks**, place it, and **right-click** it to open it: a **27-slot**
grid appears above your inventory. Move items the same way you rearrange the
inventory — **click a slot, then click where it should go** — across either grid.
Close the panel (`I` or `Esc`) and the chest keeps its contents, which are **saved
with your world**.

Breaking a chest doesn't destroy what's inside: its contents **spill back into your
inventory** (and you get the chest item back). If your inventory is too full to hold
everything, the break is refused and the chest stays put — empty it a bit first.

## Mobs and breeding

Six creatures roam the world:

- **Passive** — **sheep**, **chicken**, **horse**. They wander, flee when you get
  close, and never attack. They drop materials and raw meat when killed.
- **Hostile** — **zombie**, **skeleton**, **spider**. They hunt you at night,
  chase within their detection range, and attack when they have line of sight.
  Spiders are only hostile in the dark.

Full stats and drop tables are in the [bestiary](reference.md#mobs).

**Breeding** makes loot renewable. Right-click an adult **sheep or horse with
wheat**, or a **chicken with seeds**, to put it "in love" for **30 seconds**. Two
in-love adults of the same kind standing within **3 blocks** produce a **baby**,
which follows its parents, drops nothing while young, and grows to full size after
**~90 seconds**. The passive population is capped (and feeding costs crops), so it
stays under control.

## Farming

Grow your own food:

1. Craft a **wood hoe** (2 planks + 1 wood).
2. Right-click **grass or dirt** with the hoe to till it into **farmland**.
3. Right-click farmland with **seeds** to plant wheat. (Seeds come from breaking
   grass — about a 1-in-5 chance per block.)
4. Wait. Crops grow through four stages over **~2.5 minutes** (growth ticks happen
   near you). Breaking an **immature** crop just returns its seed; a **mature**
   crop harvests into **wheat plus 1–2 seeds**.
5. Craft **3 wheat → bread**, or use wheat to breed sheep and horses.

## Beds and sleeping

Craft a **bed** (3 wool + 3 planks) and place it. Right-click it **at night** to
sleep: the screen fades to black, time skips to a fresh morning, and the bed
becomes your **respawn point**. Sleeping is refused during the day or when a
hostile mob is within **12 blocks**, with an on-screen reason. (Wool comes from
sheep, or from crafting 4 string — a spider drop — into 1 wool.)

## Sound and music

All audio is synthesized live — there are no sound files. Block breaks, footsteps,
mob calls, and combat all have procedural effects keyed to the material or
creature. The ambient music is generative: it shifts between brighter major-key
moods by day and darker minor-key moods at night, and changes flavor by biome
(desert, ocean, forest, mountains). Adjust **master** and **music** volume — and
pick your **player skin** — from the pause menu (`Esc`).

## Saving

Your world autosaves to the browser's `localStorage` every **15 seconds**, and you
can **Save**, **Load**, or **Reset** manually from the pause menu. A save stores the
world seed plus your edits, inventory, armor, stats, time of day, bed spawn, and the
contents of every chest — so the world regenerates identically and picks up where
you left off. Because saves
live in the browser, they're tied to that browser on that device; "Reset" starts a
fresh world.
