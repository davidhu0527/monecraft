/**
 * Progression meta: gameplay statistics (running counters) and the advancement
 * registry. Everything funnels through `recordEvent`, called once per emitted
 * GameEvent from the engine's single emit chokepoint, plus `recordTick` for the
 * per-frame display counters (distance travelled, play time).
 *
 * Pure and declarative: it only reads/writes `player.stats` and
 * `player.advancements`, so it's trivially unit-testable without booting an
 * engine. `evaluateAdvancements` is a pure function of the current stats.
 */
import { BlockId } from "@/lib/world";
import { HOSTILE_MOB_KINDS } from "@/lib/game/mobs";
import { RECIPES } from "@/lib/game/recipes";
import type { GameEvent, PlayerState } from "../state";

/** How a Statistics-tab value is rendered (a plain count vs. blocks travelled vs. a clock). */
export type StatFormat = "count" | "distance" | "duration";

/** Display metadata for one statistic shown in the Statistics tab. */
export type StatMeta = { id: string; label: string; format: StatFormat };

/**
 * The statistics surfaced (in order) in the Statistics tab. recordEvent/recordTick
 * may bump counters not listed here (the per-recipe `crafted_<id>` and the per-block
 * `*_mined` counters that drive advancements) — those stay out of the display.
 */
export const STATS: readonly StatMeta[] = [
  { id: "play_time", label: "Time Played", format: "duration" },
  { id: "distance_walked", label: "Distance Travelled", format: "distance" },
  { id: "blocks_mined", label: "Blocks Mined", format: "count" },
  { id: "logs_chopped", label: "Logs Chopped", format: "count" },
  { id: "diamond_ore_mined", label: "Diamond Ore Mined", format: "count" },
  { id: "hostiles_killed", label: "Monsters Slain", format: "count" },
  { id: "animals_bred", label: "Animals Bred", format: "count" },
  { id: "items_crafted", label: "Items Crafted", format: "count" },
  { id: "items_enchanted", label: "Items Enchanted", format: "count" },
  { id: "potions_drunk", label: "Potions Drunk", format: "count" },
  { id: "fish_caught", label: "Fish Caught", format: "count" },
  { id: "treasure_unearthed", label: "Treasures Unearthed", format: "count" },
  { id: "arrows_fired", label: "Arrows Fired", format: "count" },
  { id: "villager_trades", label: "Villager Trades", format: "count" },
  { id: "minecart_rides", label: "Minecart Rides", format: "count" },
  { id: "nether_entered", label: "Nether Trips", format: "count" },
  { id: "jumps", label: "Jumps", format: "count" },
  { id: "deaths", label: "Deaths", format: "count" }
];

// Per-block "mined" counters. blockBroken always bumps the `blocks_mined` total;
// these targeted counters drive the mining / farming advancements.
const MINED_STAT_BY_BLOCK: Partial<Record<BlockId, string>> = {
  [BlockId.Wood]: "logs_chopped",
  [BlockId.Stone]: "stone_mined",
  [BlockId.CoalOre]: "coal_ore_mined",
  [BlockId.SliverOre]: "sliver_ore_mined",
  [BlockId.GoldOre]: "gold_ore_mined",
  [BlockId.RubyOre]: "ruby_ore_mined",
  [BlockId.SapphireOre]: "sapphire_ore_mined",
  [BlockId.DiamondOre]: "diamond_ore_mined",
  [BlockId.WheatStage3]: "wheat_harvested",
  [BlockId.Glowstone]: "glowstone_mined",
  [BlockId.BlaziteOre]: "blazite_ore_mined",
  [BlockId.RedstoneOre]: "redstone_ore_mined"
};

const RECIPE_BY_ID = new Map(RECIPES.map((recipe) => [recipe.id, recipe]));

function bump(player: PlayerState, id: string, by = 1): void {
  player.stats.set(id, (player.stats.get(id) ?? 0) + by);
}

/**
 * Folds one gameplay event into the stat counters. Called for every event the
 * engine emits (the `advancementUnlocked` event is guarded out upstream so this
 * never recurses). Unknown / irrelevant event types are simply ignored.
 */
export function recordEvent(player: PlayerState, event: GameEvent): void {
  switch (event.type) {
    case "blockBroken": {
      bump(player, "blocks_mined");
      const mined = MINED_STAT_BY_BLOCK[event.blockId];
      if (mined) bump(player, mined);
      break;
    }
    case "mobDied":
      if (HOSTILE_MOB_KINDS.has(event.kind)) bump(player, "hostiles_killed");
      if (event.kind === "drowned") bump(player, "drowned_killed");
      if (event.kind === "scorcher") bump(player, "scorcher_killed");
      break;
    // Counted at emit time — before the shell writes the travel save — so the
    // stat (and any unlock) rides the very save that performs the trip.
    case "dimensionTravel":
      if (event.target === "nether") bump(player, "nether_entered");
      break;
    case "mobBred":
      bump(player, "animals_bred");
      break;
    case "enchanted":
      bump(player, "items_enchanted");
      break;
    case "drankPotion":
      bump(player, "potions_drunk");
      break;
    case "fishingCaught":
      bump(player, "fish_caught");
      break;
    case "bowFired":
      bump(player, "arrows_fired");
      break;
    case "sleepStarted":
      bump(player, "sleeps");
      break;
    case "bossDefeated":
      bump(player, "boss_defeated");
      break;
    case "treasureUnearthed":
      bump(player, "treasure_unearthed");
      break;
    case "fortressLooted":
      bump(player, "fortress_looted");
      break;
    case "leverToggled":
      bump(player, "levers_flipped");
      break;
    case "vehicleBoarded":
      if (event.kind === "minecart") bump(player, "minecart_rides");
      break;
    case "died":
    case "gameOver": // hardcore permadeath emits gameOver instead of died — still a death
      bump(player, "deaths");
      break;
    case "jumped":
      bump(player, "jumps");
      break;
    case "crafted": {
      const recipe = RECIPE_BY_ID.get(event.recipeId);
      if (!recipe) break;
      bump(player, `crafted_${recipe.id}`);
      // "Items Crafted" is workbench crafts only — station outputs (smelting,
      // brewing, trading) have their own counters, so don't fold them in here.
      if (!recipe.station) bump(player, "items_crafted");
      // "Tool Up" wants any pickaxe (7 tiers, 7 recipes), so aggregate them.
      if (recipe.result.slotId.endsWith("_pickaxe")) bump(player, "pickaxes_crafted");
      // Any blazite gear counts for the post-diamond forging advancement.
      if (recipe.result.slotId.startsWith("blazite_") && recipe.result.slotId !== "blazite_ingot") bump(player, "blazite_gear_crafted");
      // A villager trade is a station-gated recipe — drive the trade advancement.
      if (recipe.station === "villager") bump(player, "villager_trades");
      break;
    }
  }
}

/**
 * Accumulates the per-frame display counters: seconds of active play and blocks
 * travelled. No advancement depends on these, so they stay out of recordEvent
 * (and the unlock path) — the engine calls this each active step.
 */
export function recordTick(player: PlayerState, dt: number, horizontalDistance: number): void {
  bump(player, "play_time", dt);
  bump(player, "distance_walked", horizontalDistance);
}

// --- Advancements ---

/** The section an advancement falls under in the Advancements tab grid. */
export type AdvancementCategory = "Mining" | "Crafting" | "Combat" | "Farming" | "Magic" | "Adventure";

/** Fixed display order for the Advancements grid; empty categories are skipped. */
export const ADVANCEMENT_CATEGORY_ORDER: readonly AdvancementCategory[] = ["Mining", "Crafting", "Combat", "Farming", "Magic", "Adventure"];

/**
 * One advancement. Unlock is uniform: `player.stats.get(stat) >= threshold`, so
 * the whole set is a declarative table — adding one is a single row, no logic.
 * `icon` is an existing item/block id rendered through `itemIconUrl` (zero new
 * assets); each maps to a counter that `recordEvent` produces.
 */
export type Advancement = {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: AdvancementCategory;
  stat: string;
  threshold: number;
};

/**
 * The tight, flat set of advancements — one per major system the player can
 * engage. Thresholds are 1 (the goal is to guide a first encounter with each
 * system); they're declarative, so tuning is a one-field edit.
 */
export const ADVANCEMENTS: readonly Advancement[] = [
  { id: "getting_wood", title: "Getting Wood", description: "Chop down a log.", icon: "wood", category: "Mining", stat: "logs_chopped", threshold: 1 },
  { id: "stone_age", title: "Stone Age", description: "Mine a block of stone.", icon: "stone", category: "Mining", stat: "stone_mined", threshold: 1 },
  { id: "ironish", title: "Iron-ish", description: "Mine sliver ore.", icon: "sliver_ore", category: "Mining", stat: "sliver_ore_mined", threshold: 1 },
  { id: "diamonds", title: "Diamonds!", description: "Mine diamond ore.", icon: "diamond_ore", category: "Mining", stat: "diamond_ore_mined", threshold: 1 },
  { id: "tool_up", title: "Tool Up", description: "Craft a pickaxe.", icon: "wood_pickaxe", category: "Crafting", stat: "pickaxes_crafted", threshold: 1 },
  { id: "hot_topic", title: "Hot Topic", description: "Craft a furnace.", icon: "furnace", category: "Crafting", stat: "crafted_furnace", threshold: 1 },
  { id: "take_aim", title: "Take Aim", description: "Fire an arrow from a bow.", icon: "bow", category: "Combat", stat: "arrows_fired", threshold: 1 },
  {
    id: "monster_hunter",
    title: "Monster Hunter",
    description: "Slay a hostile monster.",
    icon: "stone_sword",
    category: "Combat",
    stat: "hostiles_killed",
    threshold: 1
  },
  {
    id: "dragon_slayer",
    title: "Dragon Slayer",
    description: "Defeat the Dragon Lord.",
    icon: "dragon_heart",
    category: "Combat",
    stat: "boss_defeated",
    threshold: 1
  },
  { id: "two_by_two", title: "Two by Two", description: "Breed two animals.", icon: "wheat", category: "Farming", stat: "animals_bred", threshold: 1 },
  {
    id: "time_to_farm",
    title: "Time to Farm",
    description: "Harvest fully-grown wheat.",
    icon: "bread",
    category: "Farming",
    stat: "wheat_harvested",
    threshold: 1
  },
  { id: "gone_fishing", title: "Gone Fishing", description: "Reel in a catch.", icon: "fishing_rod", category: "Farming", stat: "fish_caught", threshold: 1 },
  { id: "enchanter", title: "Enchanter", description: "Enchant an item.", icon: "enchanting_table", category: "Magic", stat: "items_enchanted", threshold: 1 },
  {
    id: "local_brewery",
    title: "Local Brewery",
    description: "Drink a potion.",
    icon: "potion_strength",
    category: "Magic",
    stat: "potions_drunk",
    threshold: 1
  },
  { id: "sleep_tight", title: "Sleep Tight", description: "Sleep through the night.", icon: "bed", category: "Adventure", stat: "sleeps", threshold: 1 },
  {
    id: "hired_help",
    title: "Hired Help",
    description: "Trade with a villager.",
    icon: "emerald",
    category: "Adventure",
    stat: "villager_trades",
    threshold: 1
  },
  {
    id: "x_marks_the_spot",
    title: "X Marks the Spot",
    description: "Dig up a buried treasure chest.",
    icon: "treasure_map",
    category: "Adventure",
    stat: "treasure_unearthed",
    threshold: 1
  },
  {
    id: "fortress_raider",
    title: "Fortress Raider",
    description: "Loot a chest in a nether fortress.",
    icon: "nether_brick",
    category: "Adventure",
    stat: "fortress_looted",
    threshold: 1
  },
  {
    id: "circuit_breaker",
    title: "Circuit Breaker",
    description: "Flip a lever.",
    icon: "lever",
    category: "Adventure",
    stat: "levers_flipped",
    threshold: 1
  },
  {
    id: "on_rails",
    title: "On Rails",
    description: "Ride a minecart.",
    icon: "minecart",
    category: "Adventure",
    stat: "minecart_rides",
    threshold: 1
  },
  {
    id: "ocean_purge",
    title: "Revenge of the Tides",
    description: "Slay a drowned.",
    icon: "sliver_spear",
    category: "Combat",
    stat: "drowned_killed",
    threshold: 1
  },
  {
    id: "hot_tourist",
    title: "We Need to Go Deeper",
    description: "Step through a nether portal.",
    icon: "obsidian",
    category: "Adventure",
    stat: "nether_entered",
    threshold: 1
  },
  {
    id: "let_there_be_light",
    title: "Let There Be Light",
    description: "Mine a glowstone cluster.",
    icon: "glowstone",
    category: "Mining",
    stat: "glowstone_mined",
    threshold: 1
  },
  {
    id: "fire_fighter",
    title: "Fire Fighter",
    description: "Slay a scorcher.",
    icon: "glowstone_dust",
    category: "Combat",
    stat: "scorcher_killed",
    threshold: 1
  },
  {
    id: "blazing_edge",
    title: "Blazing Edge",
    description: "Forge any blazite gear.",
    icon: "blazite_sword",
    category: "Crafting",
    stat: "blazite_gear_crafted",
    threshold: 1
  }
];

/** Lookup by id — used to resolve an unlock's display title for the toast. */
export const ADVANCEMENTS_BY_ID: Record<string, Advancement> = Object.fromEntries(ADVANCEMENTS.map((advancement) => [advancement.id, advancement]));

/**
 * Returns the ids of advancements that just became earnable: not yet unlocked
 * and whose stat has reached its threshold. Pure over the current state, so the
 * engine can add each to `player.advancements` and announce it. Order follows the
 * registry, so the result is deterministic regardless of which event triggered it.
 */
export function evaluateAdvancements(player: PlayerState): string[] {
  const unlocked: string[] = [];
  for (const advancement of ADVANCEMENTS) {
    if (player.advancements.has(advancement.id)) continue;
    if ((player.stats.get(advancement.stat) ?? 0) >= advancement.threshold) unlocked.push(advancement.id);
  }
  return unlocked;
}
