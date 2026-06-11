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
export const FOOD_HUNGER = 7;

// Inventory
export const HOTBAR_SLOTS = 9;
export const INVENTORY_SLOTS = 36;
export const MAX_STACK_SIZE = 99;

// Mining & combat
export const MINE_REACH = 7;
export const MINING_RATE = 2.1; // progress per second per minePower
export const BARE_HAND_MINE_POWER = 0.8;
export const FIST_DAMAGE = 6;
export const ATTACK_REACH = 4.5;
export const ATTACK_AIM_DOT = 0.89; // how precisely the camera must face a mob

// Day-night cycle (daylight ranges 0.04–1.0)
export const DAY_CYCLE_SECONDS = 240;
export const HOSTILE_SPAWN_BELOW_DAYLIGHT = 0.28;
export const SPIDER_AGGRO_BELOW_DAYLIGHT = 0.42;
export const HOSTILE_BURN_ABOVE_DAYLIGHT = 0.72;

// Mob director
export const HOSTILE_SPAWN_INTERVAL_SECONDS = 10;
export const HOSTILE_CAP = 16;

// Safety & persistence
export const STUCK_RESET_SECONDS = 0.8;
export const AUTOSAVE_INTERVAL_MS = 15000;
export const SAVE_KEY = "minecraft_save_v4";

// Rendering
export const RENDER_RADIUS = 90;
export const RENDER_GRID = 20;
