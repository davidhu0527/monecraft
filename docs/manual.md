# Player Manual

A complete guide to playing Monecraft — a single-player, browser-based voxel
sandbox. Mine, build, craft, farm, fight off the night, and survive.

This page is the prose guide; for the exact numbers (every recipe, block, mob, and
item stat) see the [reference tables](reference.md). Just want the keys? They're in
the [README](../README.md#controls).

> Everything you see and hear is generated from code at runtime — there are no
> image or audio files anywhere in the game.

## Worlds & profiles

The game opens to a menu rather than dropping you straight into a world:

1. **Pick a profile.** A profile is a player — a name and an appearance (skin). On a
   shared browser everyone can have their own. Create one with **New Profile**, choose
   a skin, and you're in; rename or delete profiles from the same screen.
2. **Pick a world.** Each profile keeps its **own** list of worlds. **New World** lets
   you name it, choose a **world type** (Default, Superflat, Amplified, or Islands —
   see [the reference](reference.md#world-types)), and optionally enter a **seed** —
   type a number or a word to get the same world every time, or leave it blank for a
   random one. Worlds you've played show most-recent first; rename or delete them here too.
3. **Play.** Choosing a world drops you in. From the pause menu (**Esc**), **Save &
   Quit to Worlds** takes you back to the list, and reloading the page resumes the
   world you were in.

Everything is saved in your browser (localStorage). Deleting a world removes its save;
deleting a profile removes all of its worlds.

## Getting started: your first day

You spawn at dawn on solid ground with a small starter kit: stacks of grass, dirt,
stone, wood, planks, cobble, and sand, plus a **wood pickaxe** and a **knife**.

The day-night cycle is short — **four minutes per full day** — so the first night
comes fast. A good opening:

1. **Look around.** Double-click the game to lock the mouse (the starting gesture
   doesn't mine). Move with `W A S D`, look with the mouse.
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

| Key / input        | Action                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `W` `A` `S` `D`    | Move (walk / strafe)                                                                                          |
| `Space`            | Jump                                                                                                          |
| `C`                | Crouch (slower, careful movement)                                                                             |
| `W` + `CapsLock`   | Sprint — faster, but drains hunger                                                                            |
| Double-tap `Space` | Toggle flight in Creative (Spectator always flies); `Space` / `C` rise/descend while flying                   |
| Mouse              | Look around (double-click the game first to lock the pointer)                                                 |
| Left-click (hold)  | Break the targeted block / attack a mob                                                                       |
| Right-click or `E` | Place/interact, or throw a selected spear                                                                     |
| `1`–`9`            | Select a hotbar slot                                                                                          |
| `I`                | Open / close inventory & crafting                                                                             |
| `F`                | Eat the selected food, or drink a selected potion                                                             |
| `V`                | Cycle camera: first-person → third-person rear → third-person front                                           |
| `Shift` + `U`      | Emergency unstuck (teleport to safe ground if wedged)                                                         |
| `Esc`              | Pause menu — Game (save / load / reset / quit, Game Mode, Difficulty), Options (volume, skins), Controls tabs |
| `F3`               | Debug overlay (FPS, position, daylight, mob counts)                                                           |

Gameplay is always **eye-relative**: even in third person, your reach, aim, and
audio follow where your eyes point, and the crosshair stays centered.

## Game modes

Pick a mode when you create a world (next to the name, world type, and seed), and
switch it any time from the **pause menu** (`Esc` → Game Mode). It's saved with the
world. Modes are independent of the world type.

- **Survival** — the standard game: gather, craft, fight, and manage health and
  hunger. You can die.
- **Creative** — build freely. You fly (double-tap `Space`, then `Space` / `C` to
  rise and descend), take no damage and never hunger, break any block instantly,
  and place blocks without using them up. The recipe book is replaced by a
  searchable **palette of every item** — click one to drop a stack into your
  inventory.
- **Adventure** — survival in every way (damage, hunger, mobs, combat,
  doors/chests/trading) **except you can't break or place blocks**, so a built
  world stays as-is.
- **Spectator** — a free camera: you fly through walls (noclip), are invisible and
  invulnerable, and can't interact with anything. Mobs ignore you entirely. There's
  no hotbar or status bars — just look around.

Switching modes refills your bars and clears any pending hazard damage, so it's
always safe to flip between them.

## Difficulty

A separate dial from the game mode, picked next to it at world creation and
switchable any time from the **pause menu** (`Esc` → Difficulty). It's saved with
the world and sets _how hard_ survival is — monster numbers, how hard they hit, and
whether an empty hunger bar can kill you.

- **Peaceful** — no monsters spawn (and switching to Peaceful clears any already
  around), health regenerates twice as fast, and an empty hunger bar never hurts
  you. Full survival — gather, build, mine — minus the danger.
- **Easy** — fewer monsters and they hit at half strength; starving stops at 5
  hearts.
- **Normal** — the balanced default; starving chips you down to half a heart but no
  further.
- **Hard** — monsters spawn thick and hit 1.5× as hard, and **starving can kill
  you**.

Flipping to Peaceful mid-fight is a safe panic button — every hostile (even the
boss) vanishes at once.

## Hardcore

A toggle on the new-world form for players who want the ultimate stakes. A Hardcore
world is **locked to Survival + Hard** — you can't switch game mode or lower the
difficulty (the pause-menu switchers are greyed out), so there's no escape hatch.
Its hearts are drawn in a darker, withered red so you always know you're in it.

The defining rule: **death is permanent.** There's no respawn. When you die the run
is over — the world becomes a **dead world** you can only spectate: a free camera
that flies through everything while a **Game Over** screen offers to _Spectate_
(roam your dead world), go _Back to Worlds_, or _Delete World_. Reloading a dead
world drops you back into that same spectating state; it can never be played again.
Choose Hardcore knowing every fall, creeper, and empty hunger bar could be the last.

## Survival

### Health and death

You have **20 health**, shown as **10 hearts** (each heart = 2 HP). Mobs, falling
into the void, and starvation-adjacent danger chip it away. At zero health you die,
freeze for **3 seconds**, then respawn — at your bed if you've slept in one,
otherwise at a random land point. Death doesn't wipe your world or inventory.

If you ever get wedged inside terrain, press **`Shift`+`U`** to teleport free. (Standing in
water is _not_ "stuck" — you're allowed to swim.) You can place blocks into water
to replace water cells when building underwater. Do not remain continuously
immersed for more than **60 seconds**: after that grace period you take **1.5
hearts every second**, ignoring armor. Leaving the water resets the timer.

### Caves are dark — carry a torch

Underground is now genuinely **dark**: sunlight reaches down open shafts and
spills a little way into cave mouths, but the deep tunnels are pitch black. Craft
**torches** (1 coal + 1 wood → 4 torches) and place them as you explore — each casts
a warm pool of light that won't fade at night. Without a light source you're mining
blind, and the dark is where monsters lurk. **Coal** is the shallow, common ore you
mine for torch and furnace fuel — if you're out, smelt a log into **charcoal**, which
works the same.

### Drowning and lava

When your **head** goes underwater a row of **air bubbles** appears above the
hunger bar and drains over about 15 seconds; once it's empty you start **drowning**
(1 heart/second until you surface). Bubbles refill almost instantly when your head
comes up. (This is separate from the slow 60-second immersion damage above — wading
chest-deep never drowns you.)

**Lava** pools in the deepest caves and glows in the dark. It is a death trap:
touching it burns you **immediately** for 3 hearts every half-second — no grace
period — and you keep burning for a few seconds even after you scramble off. Armor
doesn't help. Bridge over it carefully.

### Hunger

You have **20 hunger**, shown as **10 drumsticks**. Activity burns it:

- ~1 hunger per **100 blocks sprinted**
- ~1 hunger per **300 blocks walked**
- ~1 hunger per **50 jumps**

Hunger gates two things:

- **Sprinting** needs hunger above **6** — below that you slow down.
- **Health regeneration** only runs while hunger is **12 or higher**: you heal
  about **+0.5 HP every 3 seconds** when you're fed and hurt.

And if the bar empties completely, you **starve**: half a heart every few seconds,
down to a floor that depends on difficulty (Easy stops at 5 hearts, Normal at half
a heart, **Hard kills you**; Peaceful never starves). So eat before a fight. Press **`F`** to eat the selected food. Different foods
restore different amounts — cooked meat fills far more than raw (see the
[food table](reference.md#food)).

**Watch the rotten flesh.** A zombie's drop fills a little hunger, but eating it
has a high chance to **poison** you — you'll take steady damage for a few seconds.
Poison **can't kill** (it floors at half a heart), so it's a survivable gamble
when you're starving, but cook real meat when you can.

### Combat

Hold **left-click** to swing. You hit a mob if it's within **~4.5 blocks** and
close to your crosshair (a fairly tight aim cone). Bare fists do **6 damage**;
weapons do much more and have durability that ticks down with each hit. A landed
blow knocks the mob back.

Spears trade a little melee damage for **~7-block reach**. With a spear selected,
press **`E`** or right-click to throw it: the projectile follows an arc, stops on
the first mob it hits, and costs one durability. A missed spear embeds in terrain
for two seconds before disappearing. The spear remains in your inventory until
its durability runs out. Armor, tools, knives, swords, and spears never stack;
every durable item occupies its own slot.

**Armor** reduces incoming damage. Click a helmet, face mask, neck protection,
chestplate, leggings, or boots in your inventory to **equip** it — the piece
**moves into its dedicated armor slot** (on the left of the inventory), freeing the
inventory/hotbar slot it came from. Click the armor slot to take it back off (it
returns to a free inventory slot). Each piece adds defense and absorbs durability
when you're struck — but a hit always deals at least **1 damage**, even in a full set.
Worn pieces also **show on your character** in third-person (press **V**), each tinted
toward the ore it's made from.

**Ranged combat.** Craft a **bow** (3 wood + 3 string) and **arrows** (1 stone +
1 wood + 1 feather makes 4). With the bow selected, **left-click fires an arrow**
along your aim — arrows arc with gravity, so lead distant or moving targets and
aim a little high. Each shot spends one arrow and a little bow durability. Watch
out: **skeletons now shoot back**, keeping their distance and firing arrows, so
use cover and close the gap or out-shoot them.

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
| Coal ore                  | Wood pickaxe       |
| Sliver ore                | Stone pickaxe      |
| Ruby & gold ore           | Sliver pickaxe     |
| Sapphire & diamond ore    | Ruby pickaxe       |

Higher-tier pickaxes (sapphire, gold, diamond) also mine **faster**. Dirt, sand,
wood, leaves, and crops need no special tool. Ores hide underground and in caves;
the rarer the ore, the deeper it tends to sit.

**Blasting with TNT.** Collect **gunpowder** from creepers and craft **TNT** (4
gunpowder + 1 sand). Place it like any block, then **right-click it with a torch**
to light the fuse — stand well back, because after a couple of seconds it blows a
crater and hurts anything close. TNT next to more TNT chains. It won't touch
bedrock, and it mostly destroys rather than drops blocks, so it's for digging and
demolition, not free resources.

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

The recipe book is **grouped into labeled sections** — Tools, Weapons, Armor,
Building, Food, Materials, then the station-gated Smelting, Brewing, and Trades —
and within each section the recipes you can make **right now** float to the top, so
what's craftable is easy to spot among the dimmed entries.

A dimmed recipe is no dead end: **hover it** to see exactly what's holding you back.
The tooltip lists each ingredient as **have / need** (with how many more you're
short), and for every missing item adds a **"how to obtain it"** hint — craft,
mine, hunt a mob, fish, or loot a dungeon. Station-gated recipes you can't reach
yet show **"Requires Furnace / Brewing Stand / Villager"** the same way.

The basic recipe grid is always available. **Smelting** recipes (cooking raw meat)
require a **furnace**: craft one from 8 cobble, place it, and right-click it to open
the panel in furnace mode — the cooking recipes unlock while a furnace is open and
show as "Requires Furnace" otherwise.

See the full list of **65 recipes** in the [reference](reference.md#recipes).

## Brewing and potions

Once you've gathered some gold, craft a **brewing stand** (3 cobble + 1 gold ore),
place it, and right-click it to open the panel in **brewing** mode — just like a
furnace, the potion recipes unlock while the stand is open.

Every potion starts with a **glass bottle** (3 glass → 3 bottles, on the basic
grid). Add one reagent at the stand to brew a potion:

| Potion          | Reagent    | While active                          |
| --------------- | ---------- | ------------------------------------- |
| Swiftness       | Feather    | Move noticeably faster                |
| Strength        | Gunpowder  | Hit harder in melee                   |
| Regeneration    | Wheat      | Steadily heal, even on an empty belly |
| Fire Resistance | Coal       | Wade through lava unharmed            |
| Water Breathing | Raw Fish   | Stay underwater without drowning      |
| Haste           | Gold Ore   | Mine noticeably faster                |
| Resistance      | Leather    | Shrug off some combat damage          |
| Leaping         | Sliver Ore | Jump higher                           |

**Drink** a potion the same way you eat — select it and press `F`. Its icon and a
countdown appear top-left while it lasts. Effects survive a save and reload but
are **cleared when you die**, and re-drinking the same potion just tops the timer
back up. Full numbers are in the [reference](reference.md#status-effects).

## Experience and enchanting

Playing earns **XP**, shown as a green bar above the hotbar with your **level**
over it. You gain XP for **killing mobs** (tougher mobs give more — the boss is a
big payout), **mining ores** (rarer ores give more), and **reeling in fish**. XP
is a currency, so unlike potion effects it **stays with you when you die**.

Spend it at an **enchanting table** (craft one from **2 diamond ore + 4 cobble**).
Place it, right-click to open the enchanting panel, then **select** the tool,
weapon, or armor you want to improve in your hotbar — the panel shows the
enchantments it can take. Each costs **3 levels** and can be applied up to **three
times**:

- **Sharpness** (weapons) — hit harder in melee
- **Knockback** (weapons) — your melee hits shove mobs further back
- **Looting** (weapons) — kills drop more loot
- **Power** (bows) — arrows hit harder
- **Punch** (bows) — arrows knock the target back further
- **Protection** (armor) — take less damage
- **Feather Falling** (boots) — take less fall damage
- **Efficiency** (tools) — mine faster
- **Fortune** (tools) — ore drops more of itself when you mine it
- **Unbreaking** (any gear) — gear lasts longer (it sometimes ignores wear)
- **Mending** (any gear) — XP you pick up repairs the held or worn item instead of
  banking, as long as it's damaged

Buttons grey out when you can't afford the cost or the enchant is maxed.
Enchantments are part of the item, so they're kept in chests and across reloads.
Full numbers are in the [reference](reference.md#xp--enchanting).

## The anvil

Craft an **anvil** (**3 gold ore + 4 cobble**), place it, and right-click to open
the anvil panel. Like the enchanting table it works on the **selected** hotbar
item — a tool, weapon, or armor piece — and spends XP levels:

- **Combine** a second copy of the same item into it. The result keeps the best of
  both: its durability is restored (the two bars added together, plus a bonus) and
  any enchantments are merged, taking the higher level of each. The duplicate is
  used up. Costs **4 levels**.
- **Repair** with raw material — feed it the item's tier material (e.g. a diamond
  sword takes **diamond ore**, a stone pickaxe takes **cobble**) to restore a chunk
  of durability without needing a second copy. Costs **1 level** per material unit.
- **Rename** the item to anything you like (it shows everywhere the item's name
  does). Costs **1 level**.

Buttons grey out when there's nothing to do (no duplicate, full durability, or no
matching material) or you can't afford the cost. For passive, no-table upkeep,
enchant gear with **Mending** instead.

## The grindstone

Craft a **grindstone** (**2 cobble + 2 planks**) and right-click it to open the
grindstone panel — the anvil's opposite. With an **enchanted** tool, weapon, or
armor selected in your hotbar, **Remove enchantments** strips them all off and
**refunds XP** (5 points per enchantment level removed). Handy for salvaging XP
from gear you've outgrown, or clearing an enchant you don't want before
re-enchanting. It costs nothing to use — it only gives XP back.

## Doors

Craft a **wood door** from **6 planks** and place it on a solid floor with two
clear blocks above it. A door is a thin, two-block-tall panel: right-click either
half to open or close the whole door. Closed doors block players and mobs; open
doors rotate against their hinge so you can pass. Mobs cannot open or close doors.
Breaking either half removes the whole door and returns one door item.

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

Ten creatures roam the world:

- **Passive** — **sheep**, **chicken**, **horse**, **cow**, **pig**. They wander,
  flee when you get close, and never attack. They drop materials and raw meat when
  killed — cows give leather and beef, pigs give porkchops.
- **Villager** — passive but **doesn't flee**, so you can walk right up and
  **right-click to trade** (see [Trading](#trading)). It drops nothing if killed —
  no reason to harm your shopkeeper.
- **Hostile** — **zombie**, **skeleton**, **spider**, **creeper**. They hunt you at
  night, chase within their detection range, and attack when they have line of sight.
  Every hostile has **100 HP**, shown on a health bar above its head.
  **Skeletons are archers** — they keep their distance and fire arrows, so close in
  or take cover. **Creepers** sneak up and **explode** — they light a short fuse when
  they get close (you'll hear the hiss and see them swell), then blow a crater and
  hurt you badly. Back away to defuse one, or kill it first for its gunpowder.
  Spiders are only hostile in the dark. Nothing spawns within 16 blocks of you.

Full stats and drop tables are in the [bestiary](reference.md#mobs). The summoned
**boss** is covered under [Endgame](#endgame-the-boss).

**Breeding** makes loot renewable. Right-click an adult **sheep, horse, or cow with
wheat**, or a **chicken or pig with seeds**, to put it "in love" for **30 seconds**. Two
in-love adults of the same kind standing within **3 blocks** produce a **baby**,
which follows its parents, drops nothing while young, and grows to full size after
**~90 seconds**. The passive population is capped (and feeding costs crops), so it
stays under control.

## Trading

**Villagers** wander the world like the animals, but they won't run from you —
walk up and **right-click one** to open its **trades**. The inventory's recipe book
switches to a **Trading** panel showing what the villager offers.

The currency is the **emerald**. Trading is two-sided: **sell** what you gather
(wheat, coal, leather, gold ore) for emeralds, then **spend** those emeralds on
goods you'd rather buy than make — bread, a stack of torches, arrows, a stone
pickaxe, even sliver or ruby ore to skip some mining. There's no limit beyond what
you can carry and gather, so a good farm or mine turns into steady emeralds, and
emeralds into whatever you're short on.

## Endgame: the boss

Once you've reached **diamonds**, the diamond grind finally has a goal. Craft a
**Cursed Totem** (1 diamond ore + 2 bone + 2 gold ore) and **right-click it in the
open** to summon the **boss** — a towering figure that erupts nearby. (It refuses
if a boss is already alive.)

Come prepared: full **armor**, the best sword you can make, a **bow** and plenty of
**arrows**, and some food. The boss has **1000 HP** (shown above its head and on a
bar at the top of the screen). Beside its name, a pointer continually aims toward
the boss and shows its horizontal distance in blocks, so you can find it after
breaking line of sight. It **charges you and bites hard** up close, **fires a
spread of arrows** at range, and **summons skeletons and zombies** to wear you
down. It ignores daylight, so you can fight it whenever you like — open ground
helps you kite it with the bow.

Beat it and you **win**: a victory screen appears, and it drops a **Dragon Heart**.
Craft that into the **Dragon Sword** — the strongest weapon in the game (60 attack).
You keep playing afterward, and another totem summons the boss again.

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

## Trees, saplings, and bone meal

The forest renews itself, so wood never runs out:

1. Breaking **leaves** occasionally drops a **sapling** (about 1 in 12).
2. Right-click a sapling onto **grass or dirt** to plant it. Left where it is, it
   grows into a full tree over a few minutes — but only while it sits on soil.
3. **Bone meal** speeds things up. Grind a **bone** (dropped by skeletons) into
   **3 bone meal**, then right-click it on a sapling to grow the tree **instantly**,
   or on growing **wheat** to jump it forward 1–2 stages.

Bare ground heals too: **dirt** exposed next to grass slowly turns back to grass,
so mined patches and trampled paths green over on their own.

## Fishing

A calm, renewable way to feed yourself — and the odd lucky find:

1. Craft a **fishing rod** (3 wood + 2 string).
2. Hold the rod and **right-click while aiming at water** to cast a bobber.
3. **Watch (and listen).** After a few seconds the bobber dips with a splash —
   that's a bite. **Right-click again right away** (within about a second) to reel
   it in. Miss the moment and the catch gets away, but the bobber keeps fishing.
4. You'll mostly land **raw fish** (cook it at a furnace for more hunger), sometimes
   junk (string, bone, seeds, rotten flesh), and once in a while a treasure.

Wandering too far from the bobber, putting the rod away, or draining the water all
retract the line.

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
