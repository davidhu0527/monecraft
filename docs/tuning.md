# Tuning & Balance

Every gameplay tunable lives in one place: [`lib/game/config.ts`](../lib/game/config.ts).
Each constant there carries a one-line comment; this guide is the companion that
groups them by **what they affect**, names the **system that reads each**, and
flags the **balance trade-offs** and the few that are **save-sensitive**.

To rebalance, edit `config.ts` — not the systems. Item-level numbers (a pickaxe's
power, a sword's damage, a food's hunger) are **not** here; they live with the
content in [`items.ts`](../lib/game/items.ts) (see the [reference](reference.md)).
Worldgen constants live in the frozen `GEN` object in
[`generation.ts`](../lib/world/generation.ts) and are pinned by hash tests — see
[testing.md](testing.md).

## Player feel — physics & movement

`GRAVITY`, `JUMP_VELOCITY`, `WALK_SPEED`, `SPRINT_SPEED`, `CROUCH_SPEED`,
`PLAYER_HEIGHT`, `PLAYER_HALF_WIDTH`, `EYE_HEIGHT`, `WORLD_BORDER_PADDING`.

Read by `systems/playerMotion.ts`. These set the moment-to-moment feel.
`JUMP_VELOCITY` vs `GRAVITY` together fix jump height (currently a ~1-block hop);
raise gravity for a snappier, heavier fall. `SPRINT_SPEED` is deliberately far
above `WALK_SPEED` so sprinting feels like a meaningful choice (and it's what burns
hunger fastest). `PLAYER_HALF_WIDTH`/`PLAYER_HEIGHT` are also the collision box, so
changing them affects which gaps the player fits through.

## Game modes — flight

`FLY_SPEED`, `FLY_DOUBLE_TAP_WINDOW_SECONDS`.

Used by the flight path in `systems/playerMotion.ts` and the double-tap detector
in `input/inputController.ts`. `FLY_SPEED` is the vertical climb/descend speed
while flying (Creative and Spectator); horizontal speed still comes from
`WALK_SPEED`/`SPRINT_SPEED`. `FLY_DOUBLE_TAP_WINDOW_SECONDS` is how close two
`Space` presses must be to toggle flight — raise it if a double-tap feels hard to
trigger, lower it if flight toggles by accident while bunny-hopping. (The modes
themselves and their gates live in `lib/game/gameModes.ts`, not `config.ts`.)

## Survival pressure — the main difficulty dial

`MAX_HEARTS`, `MAX_HUNGER`, `RESPAWN_SECONDS`, `HEALTH_REGEN_INTERVAL_SECONDS`,
`REGEN_MIN_HUNGER`, `SPRINT_MIN_HUNGER`, `SPRINT_BLOCKS_PER_HUNGER`,
`WALK_BLOCKS_PER_HUNGER`, `JUMPS_PER_HUNGER`, `STARVATION_INTERVAL_SECONDS`,
`STARVATION_HP`, `WATER_DAMAGE_DELAY_SECONDS`, `WATER_DAMAGE_INTERVAL_SECONDS`,
`WATER_DAMAGE_HP`.

Read by `systems/playerStats.ts` (drain + regen) and `systems/playerLife.ts`
(respawn). This group is where "how hard is it to stay alive" is set. The
`*_PER_HUNGER` budgets control how fast activity drains food — lower numbers = more
eating. The two gates are the key feedback loop: you must stay above
`REGEN_MIN_HUNGER` (12) to heal and above `SPRINT_MIN_HUNGER` (6) to sprint, so
hunger pressure indirectly throttles both combat recovery and escape speed. Keep
`REGEN_MIN_HUNGER > SPRINT_MIN_HUNGER` so there's a "can run but can't heal" band.
Water exposure is continuous body-midpoint immersion: leaving water resets both
timers. After `WATER_DAMAGE_DELAY_SECONDS` (60), environmental damage bypasses
armor every `WATER_DAMAGE_INTERVAL_SECONDS` (1) for `WATER_DAMAGE_HP` (3 HP = 1.5
hearts). These counters are transient and reset on reload/respawn.
**Starvation** is the consequence of a fully-empty hunger bar: once `hunger` hits
0, `STARVATION_HP` (1 HP) is lost every `STARVATION_INTERVAL_SECONDS` (4) down to a
**difficulty-scaled floor** (see below) — these two constants are the cadence; the
floor is the per-level dial.

## Difficulty — Peaceful / Easy / Normal / Hard

The per-level multipliers live in `lib/game/difficulties.ts` (accessor functions,
not `config.ts` constants — the _base_ values they bend stay in `config.ts`). It is
an axis orthogonal to game mode, picked at world creation and switchable in the
pause menu; the spawn directors and mob AI read `state.difficulty` every tick.

| Dial (accessor)                       | Peaceful | Easy | Normal | Hard |
| ------------------------------------- | -------- | ---- | ------ | ---- |
| `hostilesSpawn`                       | no       | yes  | yes    | yes  |
| `mobDamageMultiplier` (×hit)          | —        | 0.5  | 1      | 1.5  |
| `hostileSpawnIntervalScale`           | —        | 1.5  | 1      | 0.6  |
| `hostileCapScale` (×`HOSTILE_CAP` 16) | 0        | 8    | 16     | 24   |
| `regenIntervalScale` (×regen)         | 0.5      | 1    | 1      | 1    |
| `starvationFloorHp` (HP floor)        | never    | 10   | 1      | 0    |

Read by `systems/spawnDirector.ts` (the spawn gate + cadence/cap scales),
`systems/mobAI.ts` (the per-hit damage scale, applied at the strike — templates are
never mutated), and `systems/playerStats.ts` (faster Peaceful regen + the
starvation floor). **Peaceful** also despawns existing hostiles the moment you
switch to it (`GameEngine.switchDifficulty`). Note these dials are independent of
game mode: Peaceful stops hostile _spawns_ regardless of mode, while damage/threat
still gate on the mode (Creative is invulnerable at any difficulty). The **Hardcore**
flag (a per-world boolean, not a tunable) forces this dial to Hard and locks it — see
`docs/architecture.md` for the permadeath/game-over flow.

## Cave hazards — lava & drowning

`LAVA_DAMAGE_INTERVAL_SECONDS`, `LAVA_DAMAGE_HP`, `LAVA_BURN_SECONDS`,
`MAX_OXYGEN`, `OXYGEN_HOLD_SECONDS`, `OXYGEN_REFILL_SECONDS`,
`OXYGEN_DROWN_INTERVAL_SECONDS`, `OXYGEN_DROWN_HP`.

Read by `systems/playerStats.ts` (`tickLavaExposure`, `tickOxygen`), both on the
armor-bypassing damage path. **Lava** burns the instant you touch it (no grace
period, unlike water) for `LAVA_DAMAGE_HP` (6 = 3 hearts) every
`LAVA_DAMAGE_INTERVAL_SECONDS` (0.5) and keeps burning `LAVA_BURN_SECONDS` (3)
after you escape — the deep-cave death trap. Lava is solid, so contact is checked
underfoot/at the body, not by immersion. **Drowning** keys on the head: the
bubble meter drains over `OXYGEN_HOLD_SECONDS` (15) while the eye cell is
underwater, then deals `OXYGEN_DROWN_HP` (2) every `OXYGEN_DROWN_INTERVAL_SECONDS`
(1); surfacing refills it over `OXYGEN_REFILL_SECONDS` (1.5). This is separate
from the body-keyed 60 s water-exposure timer above — wading chest-deep never
drowns you. All these counters are transient (reset on reload/respawn).

Lighting itself has no `config.ts` tunables: the per-voxel light propagation is
in [`lib/world/lighting.ts`](../lib/world/lighting.ts) (block opacity/emission and
the 0–15 levels), and the cave-darkness floor + torch tint are shader constants in
[`GameRenderer.ts`](../lib/game/render/GameRenderer.ts) (`SKY_LIGHT_FLOOR`,
`TORCH_TINT`).

## Status effects & potions

`EFFECT_SPEED_DURATION`/`EFFECT_SPEED_MULTIPLIER`,
`EFFECT_STRENGTH_DURATION`/`EFFECT_STRENGTH_BONUS`,
`EFFECT_REGEN_DURATION`/`EFFECT_REGEN_INTERVAL`/`EFFECT_REGEN_HP`,
`EFFECT_FIRE_RESIST_DURATION`, `EFFECT_WATER_BREATHING_DURATION`,
`EFFECT_HASTE_DURATION`/`EFFECT_HASTE_MULTIPLIER`,
`EFFECT_RESISTANCE_DURATION`/`EFFECT_RESISTANCE_MULTIPLIER`,
`EFFECT_JUMP_BOOST_DURATION`/`EFFECT_JUMP_BOOST_VELOCITY`,
`POISON_DURATION`/`POISON_INTERVAL`/`POISON_HP`/`POISON_FLOOR_HP`,
`ROTTEN_FLESH_POISON_CHANCE`.

Read by `systems/statusEffects.ts` (and the seams it feeds: `playerMotion.ts`
for speed and jump-boost, the melee dispatch in `GameEngine.ts` for strength,
`mining.ts` for haste, `playerLife.ts` for resistance, and the gated
`tickLavaExposure`/`tickOxygen` for fire-resist/water-breathing). The
`*_DURATION` values are how long a drunk potion lasts (default Minecraft-ish:
buffs 3:00, Regeneration 0:45). **Strength** adds `EFFECT_STRENGTH_BONUS` (3) flat
melee damage; **Speed** multiplies movement by `EFFECT_SPEED_MULTIPLIER` (1.2);
**Haste** multiplies mining speed by `EFFECT_HASTE_MULTIPLIER` (1.4);
**Resistance** scales incoming armor-mitigated _combat_ damage by
`EFFECT_RESISTANCE_MULTIPLIER` (0.8) — environmental/poison damage is untouched;
**Jump Boost** adds `EFFECT_JUMP_BOOST_VELOCITY` (2.0) to the jump launch (chosen
to stay under the fall-damage threshold on flat ground);
**Regeneration** heals `EFFECT_REGEN_HP` (1) every `EFFECT_REGEN_INTERVAL` (1.5 s)
on its **own** accumulator, ignoring the hunger gate. **Poison** ticks `POISON_HP`
(1) every `POISON_INTERVAL` (1.25 s) but floors at `POISON_FLOOR_HP` (1) so it can
never kill; eating rotten flesh inflicts it with probability
`ROTTEN_FLESH_POISON_CHANCE` (0.8) for `POISON_DURATION` (8 s). Brewing reagent
costs are balanced in `recipes.ts`, not here. Lengthen the buffs or cut the poison
odds to make the system gentler; the reagent map is the economic dial.

## XP & enchanting

`XP_PER_LEVEL`, `FISHING_XP`, `ENCHANT_MAX_LEVEL`, `ENCHANT_COST_LEVELS`,
`SHARPNESS_DAMAGE_PER_LEVEL`, `POWER_DAMAGE_PER_LEVEL`, `PUNCH_KNOCKBACK_PER_LEVEL`,
`KNOCKBACK_PER_LEVEL`, `LOOTING_BONUS_PER_LEVEL`, `PROTECTION_DEFENSE_PER_LEVEL`,
`FEATHER_FALLING_REDUCE_PER_LEVEL`, `FEATHER_FALLING_MAX_REDUCTION`,
`EFFICIENCY_SPEED_PER_LEVEL`, `FORTUNE_BONUS_PER_LEVEL`,
`UNBREAKING_SKIP_PER_LEVEL`, `MENDING_MAX_LEVEL`, `MENDING_REPAIR_PER_XP`.

XP banks as points; `XP_PER_LEVEL` (10) points make one level. The per-mob and
per-ore XP tables live in `mobXp.ts` / `systems/xp.ts` (not here, like
`mobLoot.ts`); `FISHING_XP` (2) is the per-catch reward. Enchanting costs
`ENCHANT_COST_LEVELS` (3) levels per application, up to `ENCHANT_MAX_LEVEL` (3).
Each enchant is a flat per-level modifier read at one seam:
Sharpness `+SHARPNESS_DAMAGE_PER_LEVEL` (2) melee damage (`combat.ts` dispatch),
Power `+POWER_DAMAGE_PER_LEVEL` (2) and Punch `+PUNCH_KNOCKBACK_PER_LEVEL` (0.25)
on a fired arrow (bow-only via the enchant's `itemIds`, read in `tryFireBow`),
Knockback `+KNOCKBACK_PER_LEVEL` (0.4) on the melee shove (added to
`MELEE_KNOCKBACK_IMPULSE` in `tryAttackMob`), Looting up to
`LOOTING_BONUS_PER_LEVEL` (1) extra of each mob drop per level (rolled in
`rollMobDrops`; the killing **melee** weapon's level is forwarded through the
kill callback, so indirect kills — arrows, thrown spears, explosions — apply
none), Protection
`+PROTECTION_DEFENSE_PER_LEVEL` (2) defense (`equippedDefense` →
`armorReduction`), Feather Falling `−FEATHER_FALLING_REDUCE_PER_LEVEL` (0.15)
fall damage per level on worn boots, capped at `FEATHER_FALLING_MAX_REDUCTION`
(0.8) (read in `tickPlayerMotion`), Efficiency
`×(1 + EFFICIENCY_SPEED_PER_LEVEL × level)` mining speed (`miningSpeed`),
Fortune up to `FORTUNE_BONUS_PER_LEVEL` (1) extra ore per level on an ore mined
(rolled in `rollBlockDrops`), Unbreaking a `UNBREAKING_SKIP_PER_LEVEL` (0.2)
skip-chance per level (`consumeToolDurability`/`consumeEquippedArmorDurability`),
and Mending (`MENDING_MAX_LEVEL` 1, binary) diverting gained XP to repair
`MENDING_REPAIR_PER_XP` (2) durability per point on the held/worn item (`mendXp`,
read once in `awardXp`). Lower the costs or raise the magnitudes for faster
progression; the XP-source tables are the earning dial.

## Anvil & grindstone

`ANVIL_COMBINE_COST_LEVELS`, `ANVIL_REPAIR_COST_LEVELS`, `ANVIL_RENAME_COST_LEVELS`,
`ANVIL_REPAIR_BONUS_PCT`, `ANVIL_MATERIAL_REPAIR_PCT`, `CUSTOM_NAME_MAX_LEN`,
`GRINDSTONE_REFUND_XP_PER_LEVEL`.

The anvil spends XP levels to maintain gear (`lib/game/anvil.ts`, applied in
`GameEngine.dispatch`): **combine** a duplicate for `ANVIL_COMBINE_COST_LEVELS` (4) —
the two durabilities add together plus a `ANVIL_REPAIR_BONUS_PCT` (0.12 × max) bonus,
and enchantments merge at the higher level; **material repair** for
`ANVIL_REPAIR_COST_LEVELS` (1) restores `ANVIL_MATERIAL_REPAIR_PCT` (0.25 × max)
durability per material unit; **rename** for `ANVIL_RENAME_COST_LEVELS` (1) sets a
custom name capped at `CUSTOM_NAME_MAX_LEN` (32). The grindstone is the inverse — it
**strips** all enchantments and refunds `GRINDSTONE_REFUND_XP_PER_LEVEL` (5) XP points
per level removed (`lib/game/grindstone.ts`). Raise the repair percentages or lower
the costs to make upkeep cheaper; raise the grindstone refund to make disenchanting
more rewarding. The repair-material map (which material mends which gear) lives in
`REPAIR_MATERIAL_BY_ITEM` in `items.ts`.

## Danger — day-night & the mob director

`DAY_CYCLE_SECONDS`, `HOSTILE_SPAWN_BELOW_DAYLIGHT`, `SPIDER_AGGRO_BELOW_DAYLIGHT`,
`HOSTILE_BURN_ABOVE_DAYLIGHT`, `HOSTILE_SPAWN_INTERVAL_SECONDS`, `HOSTILE_CAP`,
`HOSTILE_SPAWN_MIN_RADIUS`, `SPAWNER_INTERVAL_SECONDS`, `SPAWNER_ACTIVATION_RADIUS`,
`SPAWNER_LOCAL_CAP`.

Read by `systems/dayNight.ts`, `systems/spawnDirector.ts`, and `systems/mobAI.ts`.
`DAY_CYCLE_SECONDS` (240) sets the whole rhythm — a shorter day means more frequent
nights and more pressure. The three daylight thresholds are a **documented engine
invariant** (daylight ranges 0.04–1.0; see architecture.md): hostiles spawn below
0.28, spiders turn hostile below 0.42, and exposed hostiles burn above 0.72. Keep
them ordered `spawn ≤ spider_aggro` and `burn` well above both, or mobs will spawn
into instant sunlight. `HOSTILE_CAP` × `HOSTILE_SPAWN_INTERVAL_SECONDS` bounds how
crowded a night gets — but both are **scaled by difficulty** (`hostileCapScale` /
`hostileSpawnIntervalScale`; Peaceful disables hostile spawning outright — see the
Difficulty section). `HOSTILE_SPAWN_MIN_RADIUS` (16) is the standoff every hostile
spawn (initial + night trickle) keeps from the player, so nothing — least of all a
creeper — can appear point-blank. Tests aim daylight explicitly (a `calmDaytime`
helper) to avoid first-night aggro.

**Dungeon spawners** are a separate, time-independent danger source: while the
player is within `SPAWNER_ACTIVATION_RADIUS` (16) of an intact spawner, it drips
one hostile every `SPAWNER_INTERVAL_SECONDS` (8) up to `SPAWNER_LOCAL_CAP` (6)
clustered nearby — all still under the shared `HOSTILE_CAP`. Lower the interval or
raise the local cap to make dungeons nastier. The dungeon count itself is a
worldgen constant (`GEN.dungeonCount`, see below).

## Weather (cosmetic)

`WEATHER_CYCLE_SECONDS`, `WEATHER_RAIN_FRACTION`.

Read by `systems/weather.ts`. Purely visual/audio — weather **does not** touch
spawning, daylight, or any balance dial. Time is split into `WEATHER_CYCLE_SECONDS`
(180) windows, and a seeded hash of the window index makes `WEATHER_RAIN_FRACTION`
(~0.35, so roughly one window in three) precipitate, with the player's biome
choosing the form (snow in the mountains, clear in desert/ocean, rain elsewhere).
`state.weather` is transient — never saved. Raise the fraction for a wetter world;
shorten the cycle for more frequent, briefer showers.

## Progression — mining & combat reach

`MINE_REACH`, `MINING_RATE`, `BARE_HAND_MINE_POWER`, `FIST_DAMAGE`, `ATTACK_REACH`,
`ATTACK_AIM_DOT`, `MELEE_KNOCKBACK_IMPULSE`, `SPEAR_MELEE_REACH`, `SPEAR_THROW_SPEED`,
`SPEAR_THROW_GRAVITY`, `SPEAR_THROW_LIFETIME_SECONDS`,
`SPEAR_STUCK_SECONDS`, `SPEAR_THROW_COOLDOWN_SECONDS`, `SPEAR_HIT_RADIUS`.

Read by `systems/mining.ts`, `systems/combat.ts`, and `systems/spears.ts`.
`MINING_RATE` × a tool's
`minePower` (from `items.ts`) ÷ block hardness = break time, so this constant scales
_all_ mining globally while item tiers scale it per-tool. Note the deliberate
asymmetry: `MINE_REACH` (7) is longer than `ATTACK_REACH` (4.5) — you can dig
farther than you can punch. `ATTACK_AIM_DOT` (0.89) is how precisely the crosshair
must point at a mob to hit it — lower is more forgiving. `MELEE_KNOCKBACK_IMPULSE`
(0.75) is the base horizontal shove a melee hit gives a mob — the Knockback
enchantment adds to it. The per-ore **tool-tier
gate** itself lives in `systems/mining.ts` (`canMineBlock`), not config. Spears
override only melee reach; their projectile speed, gravity, lifetime, cooldown,
terrain embed duration, and collision radius are global, while tier
damage/durability live in `items.ts`.

## Ranged combat & endgame

Arrows: `ARROW_SPEED`, `ARROW_GRAVITY`, `ARROW_TTL`, `ARROW_HIT_RADIUS`,
`ARROW_MAX_SUBSTEPS`, `ARROW_MAX_SEGMENT`.
Bow: `BOW_ARROW_DAMAGE`, `BOW_KNOCKBACK`, `BOW_COOLDOWN_SECONDS`, `BOW_DURABILITY_PER_SHOT`.
Ranged mobs: `SKELETON_STANDOFF_MIN/MAX`, `SKELETON_ARROW_DAMAGE`, `SKELETON_ARROW_SPEED`,
`SKELETON_FIRE_VGAP`, `SKELETON_LEAD_FACTOR`, `MOB_ARROW_KNOCKBACK`.
Hostile health: `HOSTILE_MOB_HP` (shared by zombie, skeleton, spider, and
creeper). Boss: `BOSS_HP`, `BOSS_MELEE_REACH`,
`BOSS_MELEE_DAMAGE`, `BOSS_ARROW_DAMAGE`,
`BOSS_ARROW_SPEED`, `BOSS_SPREAD`, `BOSS_SUMMON_RADIUS`, `BOSS_MINION_CAP`,
`BOSS_SUMMON_INTERVAL_SECONDS`.

Read by `systems/projectileAI.ts`, `systems/combat.ts`, and `systems/mobAI.ts`.
`ARROW_GRAVITY` (14) is below the player's `GRAVITY` (26) so arrows fly flatter and
read clearly; `ARROW_MAX_SEGMENT`/`ARROW_MAX_SUBSTEPS` bound the per-frame anti-tunnel
substepping (raise the substep cap only if very fast arrows ever slip past thin mobs).
`BOW_COOLDOWN_SECONDS` is the fire rate; bow/Dragon-Sword durability and damage live in
`items.ts`. The skeleton standoff band is the kite distance — widen it to make archers
harder to corner. `HOSTILE_MOB_HP` (100) sets ordinary hostile durability, while
`BOSS_HP` (1000) makes the boss a sustained fight. `BOSS_MINION_CAP` and the shared
`HOSTILE_CAP` together bound how crowded it gets (the
boss summon itself bypasses the spawn-director cap so the fight always starts).

## Explosions, creepers & TNT

Explosion: `EXPLOSION_DAMAGE_PER_POWER`.
Creeper: `CREEPER_EXPLOSION_POWER`, `CREEPER_FUSE_SECONDS`, `CREEPER_FUSE_RANGE`,
`CREEPER_ABORT_RANGE`.
TNT: `TNT_EXPLOSION_POWER`, `TNT_FUSE_SECONDS`, `TNT_CHAIN_FUSE_MIN_SECONDS`,
`TNT_CHAIN_FUSE_MAX_SECONDS`.

Read by `systems/explosion.ts` and `systems/mobAI.ts`. A blast's **power** is its
block-destruction radius; it also damages out to **twice** that radius. Peak
(point-blank) damage is `power × EXPLOSION_DAMAGE_PER_POWER` (6), tapering linearly
to the edge — so raising a power both widens the crater and hits harder. Per-block
`blastResistance` (which blocks survive a given strength) and the unbreakable set
(bedrock/spawner/lava) live in `explosion.ts`, not config. `CREEPER_FUSE_RANGE`
arms the fuse; `CREEPER_ABORT_RANGE` (larger) defuses it when you flee. `TNT_*`
fuses gate the lit delay and the randomized chain delay that ripples one blast into
the next. Damage uses the armor-aware path, so armor still mitigates a blast.

## Farming & breeding pace

Farming: `RANDOM_TICK_INTERVAL_SECONDS`, `RANDOM_TICK_SAMPLES`, `RANDOM_TICK_RADIUS`,
`CROP_GROWTH_CHANCE`, `GRASS_SEED_DROP_CHANCE`.
Living world: `SAPLING_GROWTH_CHANCE`, `LEAVES_SAPLING_DROP_CHANCE`,
`GRASS_SPREAD_CHANCE`, `BONE_MEAL_PER_BONE`, `BONE_MEAL_CROP_STAGES_MAX`.
Breeding: `BREED_FED_WINDOW_SECONDS`, `BREED_PARTNER_RADIUS`,
`BREED_CHECK_INTERVAL_SECONDS`, `BABY_GROW_SECONDS`, `BABY_SCALE`, `PASSIVE_CAP`.

Read by `systems/randomTicks.ts` and `systems/breeding.ts`. The random-tick group
controls crop growth statistically: each interval samples `RANDOM_TICK_SAMPLES`
columns within `RANDOM_TICK_RADIUS` of the player and advances eligible crops with
`CROP_GROWTH_CHANCE` probability — together ≈ 50 s/stage (~2.5 min to mature). More
samples or a larger radius means crops far from the player keep growing, at more
per-tick work. Breeding is bounded by `PASSIVE_CAP` (24) plus the crop cost of
feeding, so animals can't explode in number.

The same sampler drives the **living world** (read by `systems/randomTicks.ts`
and `systems/treeGrowth.ts`). `SAPLING_GROWTH_CHANCE` (0.12) is deliberately
below `CROP_GROWTH_CHANCE` so a tree is a slower, bigger event than a wheat
stage; a sapling only matures while it sits on grass/dirt/farmland.
`LEAVES_SAPLING_DROP_CHANCE` (0.08) is the per-break odds a leaf block yields a
sapling — its only drop, so the rate sets how renewable wood is. `GRASS_SPREAD_CHANCE`
(0.18) is the per-tick odds exposed dirt re-grasses when a face-neighbour column's
top block is grass — raise it to heal terrain faster, lower it to leave scars
longer. Bone meal short-circuits the wait: `BONE_MEAL_PER_BONE` (3) is the grind
yield, and one application advances a crop a random `1..BONE_MEAL_CROP_STAGES_MAX`
(2) stages or grows a sapling instantly.

## Fishing

`FISHING_REACH`, `FISHING_BITE_MIN_SECONDS`, `FISHING_BITE_MAX_SECONDS`,
`FISHING_BITE_WINDOW_SECONDS`, `FISHING_TETHER_DISTANCE`, `FISHING_ROD_DURABILITY`.

Read by `systems/fishing.ts`. `FISHING_REACH` (7) is how far water can be to cast,
matching mining reach. The wait before a bite is a uniform random in
`[FISHING_BITE_MIN_SECONDS, FISHING_BITE_MAX_SECONDS]` (2–5 s) — widen it for a
slower, more patient rhythm. Note the wait is also the throttle on the whole catch
table, so shortening it raises the rate of the rare treasure too; drop the emerald
weight in `FISHING_LOOT` if you make bites much faster. `FISHING_BITE_WINDOW_SECONDS` (1.2) is the reaction
window to reel in once the bobber dips: lower it to demand sharper timing, raise it
to be forgiving. `FISHING_TETHER_DISTANCE` (12) auto-cancels a cast if the player
strays past it. `FISHING_ROD_DURABILITY` (64, in `items.ts` via this constant) is
how many catches a rod lands before breaking — only a successful reel wears it.
The catch odds live in the weighted `FISHING_LOOT` table in `lib/game/fishingLoot.ts`,
not here.

## Beds & sleep

`SLEEP_ALLOWED_BELOW_DAYLIGHT`, `SLEEP_HOSTILE_RADIUS`, `SLEEP_FADE_SECONDS`,
`WAKE_DAY_PHASE`.

Read by the sleep path in `systems/interact.ts` / `GameEngine`. Sleeping is gated
to night (matching `HOSTILE_SPAWN_BELOW_DAYLIGHT`) and refused if a hostile is
within `SLEEP_HOSTILE_RADIUS`. `WAKE_DAY_PHASE` is where the day clock lands on
waking (a fresh dawn).

## Inventory

`HOTBAR_SLOTS`, `INVENTORY_SLOTS`, `MAX_STACK_SIZE`. **Save-sensitive** — see below.

`CHEST_SLOTS` (27) is the storage capacity of a placed chest, read by the interact,
mining, and save paths (`lib/game/engine/systems/interact.ts`, `…/mining.ts`,
`lib/game/save.ts`) and the inventory panel grid. It is **soft** save-sensitive:
shrinking it after chests have been saved with items past the new limit would drop
those overflow slots on load (`readContainers` rebuilds a `CHEST_SLOTS`-length array).

## Persistence & rendering

`AUTOSAVE_INTERVAL_MS`, `WORLDGEN_VERSION`, `SAVE_KEY` (legacy), `STUCK_RESET_SECONDS`,
`RENDER_RADIUS`, `RENDER_GRID`, `THIRD_PERSON_DISTANCE`, `THIRD_PERSON_MARGIN`.

`RENDER_RADIUS` is the biggest **performance** lever: the renderer meshes one region
of this radius around the player, so larger values draw more terrain at higher cost;
`RENDER_GRID` is how far the player moves before that mesh rebuilds (smaller = more
frequent rebuilds, fresher view). `STUCK_RESET_SECONDS` is how long an overlap is
tolerated before the auto-unstuck teleport fires.

## Save- and worldgen-sensitive tunables

Change these only with care:

- **`WORLDGEN_VERSION`** (`8`) is the worldgen baseline each world records at
  creation. When a deliberate terrain change invalidates old block-diffs, bump this:
  every world whose recorded version differs discards its stale diffs and reboots from
  its seed — per-world, without renaming any key (see [save-format.md](save-format.md)).
  This replaced the old whole-store `SAVE_KEY` bump, which reset _every_ world at once.
  It's versioned independently of the save **schema** (currently v5); don't bump it to
  express a schema change — add a migration instead.
- **`SAVE_KEY`** (`"minecraft_save_v7"`) is now **legacy**: each world has its own
  `minecraft_world_save_<id>` key, and `SAVE_KEY` is read only once by the one-time
  migration. Leave it alone.
- **`INVENTORY_SLOTS` / `HOTBAR_SLOTS` / `MAX_STACK_SIZE`** affect the saved
  inventory layout. `save.ts` already migrates the v1 (40-slot) → v2 (36-slot)
  change; altering these again needs a matching migration or old saves break.
- **Daylight thresholds and `WAKE_DAY_PHASE`** shape the persisted `dayClock`'s
  meaning but are not save-format-breaking on their own.
- **Worldgen is not tuned here.** Terrain/ore/structure constants live in the
  frozen `GEN` object in `generation.ts` and are a byte-identical save contract
  pinned by hash tests — changing them requires the re-baseline policy in
  [testing.md](testing.md). This includes **`GEN.dungeonCount`** (28, how many
  dungeon rooms are attempted), **`GEN.coalConfig`** (coal vein attempts/depth/size —
  coal is placed on its own PRNG in `placeCoal`, so retuning it shifts only coal,
  not the rest of the terrain), and the dungeon loot tables / tier odds in
  `lib/game/dungeonLoot.ts` (loot is pure logic, not a worldgen byte contract, but
  changing the _placement_ count or geometry is).
- **World types** (Default / Superflat / Amplified / Islands) are terrain-config
  variations of `GEN` in **`terrainConfigFor`** (`generation.ts`) — they change
  only sea level and per-biome surface height (base + noise amplitude). `"default"`
  returns the GEN values verbatim, so it stays byte-identical; each non-default
  type has its own pinned hash. Tuning a type's numbers (e.g. the Islands sea level,
  or Amplified's amplitude multiplier) is a deliberate re-baseline for that type
  and bumps `WORLDGEN_VERSION` (which discards stale worlds of every type). Islands
  values are constrained by spawn: keep land biomes gently sloped so
  `findSpawnOnLand` still lands the player on dry ground.
