// Gameplay tunables. Item/block data lives in items.ts, recipes in recipes.ts.

// Player physics
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_HALF_WIDTH = 0.3;
export const EYE_HEIGHT = 1.62;
export const GRAVITY = 26;
export const JUMP_VELOCITY = 8.2;
export const WALK_SPEED = 4.8;
export const SPRINT_SPEED = 12.8;
export const CROUCH_SPEED = 2.1;
export const WORLD_BORDER_PADDING = 1.2;

// Player stats — Minecraft ranges: 20 HP shown as 10 hearts, 20 hunger as 10 drumsticks.
export const MAX_HEARTS = 20;
export const MAX_HUNGER = 20;
export const RESPAWN_SECONDS = 3;
export const HEALTH_REGEN_INTERVAL_SECONDS = 3;
export const WATER_DAMAGE_DELAY_SECONDS = 60;
export const WATER_DAMAGE_INTERVAL_SECONDS = 1;
export const WATER_DAMAGE_HP = 3; // 1.5 hearts
// Lava burns on contact (no delay), keeps burning briefly after you escape, and
// bypasses armor — a deep-cave death trap, far deadlier than water.
export const LAVA_DAMAGE_INTERVAL_SECONDS = 0.5;
export const LAVA_DAMAGE_HP = 6; // 3 hearts per tick
export const LAVA_BURN_SECONDS = 3; // damage lingers this long after leaving lava
// Drowning: the bubble bar empties over OXYGEN_HOLD_SECONDS with the head
// underwater, then drowning damage starts; it refills quickly on surfacing.
// Separate from the slow 60s water-exposure timer (which keys on the body).
export const MAX_OXYGEN = 10;
export const OXYGEN_HOLD_SECONDS = 15; // full breath -> empty while submerged
export const OXYGEN_REFILL_SECONDS = 1.5; // empty -> full after surfacing
export const OXYGEN_DROWN_INTERVAL_SECONDS = 1;
export const OXYGEN_DROWN_HP = 2; // 1 heart per tick once out of air
// Health regen only runs at or above this hunger level; sprint needs more than SPRINT_MIN_HUNGER.
export const REGEN_MIN_HUNGER = 12;
export const SPRINT_MIN_HUNGER = 6;
// Hunger drain: one point per N blocks sprinted/walked, or per N jumps.
export const SPRINT_BLOCKS_PER_HUNGER = 100;
export const WALK_BLOCKS_PER_HUNGER = 300;
export const JUMPS_PER_HUNGER = 50;

// Status effects — timed buffs drunk from potions (Speed/Strength/Regeneration/
// Fire Resistance/Water Breathing) plus Poison, a never-lethal hazard from eating
// rotten flesh. Durations are seconds; re-drinking refreshes to the longer of the
// two remaining times. Single-level effects (no tiers). All values are tunable.
export const EFFECT_SPEED_DURATION = 180;
export const EFFECT_SPEED_MULTIPLIER = 1.2; // ×movement speed while active
export const EFFECT_STRENGTH_DURATION = 180;
export const EFFECT_STRENGTH_BONUS = 3; // +melee damage per hit while active
export const EFFECT_REGEN_DURATION = 45;
export const EFFECT_REGEN_INTERVAL = 1.5; // heal cadence — its OWN accumulator, not the hunger-gated regen
export const EFFECT_REGEN_HP = 1; // HP restored each interval (regardless of hunger)
export const EFFECT_FIRE_RESIST_DURATION = 180;
export const EFFECT_WATER_BREATHING_DURATION = 180;
// Poison: ticks armor-bypassing damage but floors at POISON_FLOOR_HP so it can
// chip you down to half a heart yet never deliver the killing blow.
export const POISON_DURATION = 8;
export const POISON_INTERVAL = 1.25;
export const POISON_HP = 1;
export const POISON_FLOOR_HP = 1; // poison never drops hearts below this
export const ROTTEN_FLESH_POISON_CHANCE = 0.8; // odds eating rotten flesh poisons you

// Inventory
export const HOTBAR_SLOTS = 9;
export const INVENTORY_SLOTS = 36;
export const MAX_STACK_SIZE = 99;
// Storage slots in a placed chest (a 9x3 grid, like a Minecraft single chest).
export const CHEST_SLOTS = 27;

// Mining & combat
export const MINE_REACH = 7;
export const MINING_RATE = 2.1; // progress per second per minePower
export const BARE_HAND_MINE_POWER = 0.8;
export const FIST_DAMAGE = 6;
export const ATTACK_REACH = 4.5;
export const ATTACK_AIM_DOT = 0.89; // how precisely the camera must face a mob
export const SPEAR_MELEE_REACH = 7;
export const SPEAR_THROW_SPEED = 32;
export const SPEAR_THROW_GRAVITY = 6;
export const SPEAR_THROW_LIFETIME_SECONDS = 4;
export const SPEAR_STUCK_SECONDS = 2;
export const SPEAR_THROW_COOLDOWN_SECONDS = 0.45;
export const SPEAR_HIT_RADIUS = 0.65;

// Ranged combat — arrows are transient projectiles shared by the bow, ranged
// skeletons, and the boss. Gravity is below the player's so the arc stays flat
// and readable; substepping the swept block/entity tests stops fast arrows from
// tunnelling through 1-block walls or thin mobs between frames.
export const ARROW_SPEED = 34; // m/s launch speed (skeletons/boss scale this down)
export const ARROW_GRAVITY = 14; // < player GRAVITY (26)
export const ARROW_TTL = 4; // seconds before an in-flight arrow despawns
export const ARROW_HIT_RADIUS = 0.45; // hit padding around the arrow point
export const ARROW_MAX_SUBSTEPS = 4; // cap on per-frame integration substeps
export const ARROW_MAX_SEGMENT = 0.5; // blocks per substep before the swept tests run

// Bow — instant click-to-fire (no draw-charge); fixed damage, gated by a cooldown.
export const BOW_ARROW_DAMAGE = 9; // matches a stone sword's melee, but at range
export const BOW_KNOCKBACK = 0.6;
export const BOW_COOLDOWN_SECONDS = 0.4;
export const BOW_DURABILITY_PER_SHOT = 1;

// Ranged mobs (skeletons, boss) — kite within a standoff band and loose arrows
// instead of meleeing. Lead aims slightly ahead of a moving target.
export const SKELETON_STANDOFF_MIN = 5; // back away when the player is closer than this
export const SKELETON_STANDOFF_MAX = 9; // approach when farther; hold in the band
export const SKELETON_ARROW_DAMAGE = 4;
export const SKELETON_ARROW_SPEED = 27; // a touch slower than the player's bow (34)
export const SKELETON_FIRE_VGAP = 3; // max vertical gap to the player to shoot
export const SKELETON_LEAD_FACTOR = 0.6; // fraction of travel-time lead on a moving target
export const MOB_ARROW_KNOCKBACK = 0.35;

// Endgame boss — summoned from a Cursed Totem (diamond-gated). It approaches
// (does not kite), melees up close, looses a 3-arrow spread at range, and
// periodically summons minions. Its defeat is the win condition.
export const HOSTILE_MOB_HP = 100;
export const BOSS_HP = 1000;
export const BOSS_MELEE_REACH = 3.5;
export const BOSS_MELEE_DAMAGE = 10;
export const BOSS_ARROW_DAMAGE = 7;
export const BOSS_ARROW_SPEED = 30;
export const BOSS_SPREAD = 0.18; // radians between the three spread arrows
export const BOSS_SUMMON_RADIUS = 10; // where the boss appears, around the player
export const BOSS_MINION_CAP = 4; // boss-summoned minions alive at once
export const BOSS_SUMMON_INTERVAL_SECONDS = 12;

// Creepers, TNT & explosions. An explosion destroys blocks within `power` (with a
// distance falloff vs each block's blast resistance) and damages the player/mobs
// out to twice that radius, also with falloff. Damage scales with power, so a
// bigger blast both digs a wider crater and hits harder.
export const EXPLOSION_DAMAGE_PER_POWER = 6; // peak (point-blank) damage = power × this
export const CREEPER_EXPLOSION_POWER = 3; // crater radius in blocks
export const CREEPER_FUSE_SECONDS = 1.5; // hiss-to-detonation once primed
export const CREEPER_FUSE_RANGE = 2.6; // how close the player must be to light the fuse
export const CREEPER_ABORT_RANGE = 4.5; // walk past this while primed and the fuse aborts
export const TNT_EXPLOSION_POWER = 4; // a stronger blast than a creeper
export const TNT_FUSE_SECONDS = 2.5; // delay between igniting and detonating
// A blast lights neighboring TNT after a short, randomized fuse so chains ripple.
export const TNT_CHAIN_FUSE_MIN_SECONDS = 0.1;
export const TNT_CHAIN_FUSE_MAX_SECONDS = 0.35;

// Day-night cycle (daylight ranges 0.04–1.0)
export const DAY_CYCLE_SECONDS = 240;
export const HOSTILE_SPAWN_BELOW_DAYLIGHT = 0.28;
export const SPIDER_AGGRO_BELOW_DAYLIGHT = 0.42;
export const HOSTILE_BURN_ABOVE_DAYLIGHT = 0.72;

// Weather (cosmetic, transient — never persisted, never touches spawn balance).
// Time is split into fixed windows; a seeded hash of the window index decides
// whether it precipitates, and a triangular envelope ramps intensity in/out.
export const WEATHER_CYCLE_SECONDS = 180;
export const WEATHER_RAIN_FRACTION = 0.35;

// Beds & sleep
// Sleeping is only allowed once it is night by the game's own definition (the
// hostile-spawn threshold). The fade is the frozen window before time skips;
// waking lands at this fraction of the cycle (a rising ~0.45 daylight morning).
export const SLEEP_ALLOWED_BELOW_DAYLIGHT = 0.28;
export const SLEEP_HOSTILE_RADIUS = 12;
export const SLEEP_FADE_SECONDS = 1.5;
export const WAKE_DAY_PHASE = 0.07;

// Mob director
export const HOSTILE_SPAWN_INTERVAL_SECONDS = 10;
export const HOSTILE_CAP = 16;
// Hostiles never spawn closer than this to the player, so nothing — least of all
// a creeper — can materialize point-blank and attack before you can react.
export const HOSTILE_SPAWN_MIN_RADIUS = 16;

// Dungeon spawners. A spawner drips one hostile every interval while the player
// is within the activation radius, up to a local cluster cap (and the shared
// global HOSTILE_CAP). Time-independent — dungeons are dark.
export const SPAWNER_INTERVAL_SECONDS = 8;
export const SPAWNER_ACTIVATION_RADIUS = 16;
export const SPAWNER_LOCAL_CAP = 6;

// Animal breeding. Feeding a passive animal puts it "in love" for a window; two
// in-love adults of the same kind within range spawn a baby that grows up after
// a timer. The passive cap and the wheat/seed cost bound the population.
export const BREED_FED_WINDOW_SECONDS = 30;
export const BREED_PARTNER_RADIUS = 3;
export const BREED_CHECK_INTERVAL_SECONDS = 0.5;
export const BABY_GROW_SECONDS = 90;
export const BABY_SCALE = 0.55;
export const PASSIVE_CAP = 24;

// Random block ticks (crop growth; the system is extensible to other blocks).
// Each interval samples N columns within RADIUS of the player and runs the
// block's handler. ~128 samples/s over a 64x64 area ≈ 50 s/stage (~2.5 min to
// mature). GRASS_SEED_DROP_CHANCE is the per-break odds a grass block drops a seed.
export const RANDOM_TICK_INTERVAL_SECONDS = 0.5;
export const RANDOM_TICK_SAMPLES = 64;
export const RANDOM_TICK_RADIUS = 32;
export const CROP_GROWTH_CHANCE = 0.65;
export const GRASS_SEED_DROP_CHANCE = 0.2;
// Living world. A sapling matures slower than a crop (a tree is a bigger event):
// at ~0.12 per sampled tick it takes a few in-range minutes, or instantly with
// bone meal. LEAVES_SAPLING_DROP_CHANCE is the per-break odds a leaf block yields
// a sapling (its only drop). GRASS_SPREAD_CHANCE is the per-tick odds an exposed
// dirt block beside grass re-grasses.
export const SAPLING_GROWTH_CHANCE = 0.12;
export const LEAVES_SAPLING_DROP_CHANCE = 0.08;
export const GRASS_SPREAD_CHANCE = 0.18;
// Bone meal: how many units one bone grinds into, and how many crop stages a
// single application advances (a random 1..BONE_MEAL_CROP_STAGES_MAX, like
// Minecraft); on a sapling it grows the tree instantly.
export const BONE_MEAL_PER_BONE = 3;
export const BONE_MEAL_CROP_STAGES_MAX = 2;

// Fishing. Cast a bobber at water within FISHING_REACH; after a random wait in
// [BITE_MIN, BITE_MAX] the bobber dips for FISHING_BITE_WINDOW_SECONDS — reel in
// (right-click) during that window to catch, else a new wait begins. The cast is
// auto-cancelled if the player strays past FISHING_TETHER_DISTANCE from the bobber
// (or unequips the rod / the water drains). The rod is a durable tool.
export const FISHING_REACH = 7;
export const FISHING_BITE_MIN_SECONDS = 2;
export const FISHING_BITE_MAX_SECONDS = 5;
export const FISHING_BITE_WINDOW_SECONDS = 1.2;
export const FISHING_TETHER_DISTANCE = 12;
export const FISHING_ROD_DURABILITY = 64;

// XP & enchanting. XP accrues from kills, ore mining, and fishing (the per-mob
// and per-ore tables live in mobXp.ts / systems/xp.ts, like mobLoot.ts), banked
// as points; XP_PER_LEVEL points make one level. Levels are spent at an
// enchanting table — ENCHANT_COST_LEVELS per application, up to ENCHANT_MAX_LEVEL.
// Each enchant is a flat per-level modifier at one existing seam.
export const XP_PER_LEVEL = 10;
export const FISHING_XP = 2;
export const ENCHANT_MAX_LEVEL = 3;
export const ENCHANT_COST_LEVELS = 3; // XP levels per enchant application
export const SHARPNESS_DAMAGE_PER_LEVEL = 2; // +melee damage per level
export const PROTECTION_DEFENSE_PER_LEVEL = 2; // +defense points per level (feeds armorReduction)
export const EFFICIENCY_SPEED_PER_LEVEL = 0.3; // mining speed ×(1 + level × this)
export const UNBREAKING_SKIP_PER_LEVEL = 0.2; // chance per level to skip durability wear

// Safety & persistence
export const STUCK_RESET_SECONDS = 0.8;
export const AUTOSAVE_INTERVAL_MS = 15000;
// Legacy single-world save key. Since the multi-world feature, each world owns
// its own `minecraft_world_save_<id>` blob (see lib/game/worlds.ts); this key
// is only read once by the legacy migration (lib/game/legacyMigration.ts) and
// is otherwise unused.
export const SAVE_KEY = "minecraft_save_v7";

// The deterministic world-generation baseline. Bumped whenever worldgen
// changes, so old block-diffs (which index against generated terrain) can't be
// applied to a different baseline: v6 added dungeons; v7 added deep-cave lava
// lakes; v8 added shallow coal ore. Each world records the WORLDGEN_VERSION it
// was generated under; a world whose recorded version differs from this constant
// has its block-diffs discarded and is rebooted from its stored seed
// (lib/game/worlds.ts). The save *schema* (SaveData, currently v6) is independent
// of this — lighting is a derived cache and lava is worldgen, so neither is
// persisted, and additive schema bumps (like v6's status effects) don't touch it.
export const WORLDGEN_VERSION = 8;

// Rendering
export const RENDER_RADIUS = 90;
export const RENDER_GRID = 20;
// Third-person camera boom, clamped against walls with a margin that keeps
// the near plane (0.1) out of the blocking block.
export const THIRD_PERSON_DISTANCE = 4;
export const THIRD_PERSON_MARGIN = 0.2;
