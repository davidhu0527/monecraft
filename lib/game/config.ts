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
// Health regen only runs at or above this hunger level; sprint needs more than SPRINT_MIN_HUNGER.
export const REGEN_MIN_HUNGER = 12;
export const SPRINT_MIN_HUNGER = 6;
// Hunger drain: one point per N blocks sprinted/walked, or per N jumps.
export const SPRINT_BLOCKS_PER_HUNGER = 100;
export const WALK_BLOCKS_PER_HUNGER = 300;
export const JUMPS_PER_HUNGER = 50;

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
export const BOSS_HP = 400; // a real fight even with diamond gear
export const BOSS_MELEE_REACH = 3.5;
export const BOSS_MELEE_DAMAGE = 10;
export const BOSS_ARROW_DAMAGE = 7;
export const BOSS_ARROW_SPEED = 30;
export const BOSS_SPREAD = 0.18; // radians between the three spread arrows
export const BOSS_SUMMON_RADIUS = 10; // where the boss appears, around the player
export const BOSS_MINION_CAP = 4; // boss-summoned minions alive at once
export const BOSS_SUMMON_INTERVAL_SECONDS = 12;

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

// Safety & persistence
export const STUCK_RESET_SECONDS = 0.8;
export const AUTOSAVE_INTERVAL_MS = 15000;
// Bumped to v6 with the dungeon worldgen: dungeons change the deterministic
// world baseline, so old block-diffs would index against the wrong terrain.
export const SAVE_KEY = "minecraft_save_v6";

// Rendering
export const RENDER_RADIUS = 90;
export const RENDER_GRID = 20;
// Third-person camera boom, clamped against walls with a margin that keeps
// the near plane (0.1) out of the blocking block.
export const THIRD_PERSON_DISTANCE = 4;
export const THIRD_PERSON_MARGIN = 0.2;
