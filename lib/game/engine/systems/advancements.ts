/**
 * Progression meta: gameplay statistics (running counters) and the advancement
 * registry. Everything funnels through `recordEvent`, called once per emitted
 * GameEvent from the engine's single emit chokepoint, plus `recordTick` for the
 * per-frame display counters (distance travelled, play time).
 *
 * Pure and declarative: it only reads/writes `state.stats` and
 * `state.advancements`, so it's trivially unit-testable without booting an
 * engine. `evaluateAdvancements` is a pure function of the current stats.
 */
import { BlockId } from "@/lib/world";
import { HOSTILE_MOB_KINDS } from "@/lib/game/mobs";
import { RECIPES } from "@/lib/game/recipes";
import type { GameEvent, GameState } from "../state";

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
  { id: "arrows_fired", label: "Arrows Fired", format: "count" },
  { id: "villager_trades", label: "Villager Trades", format: "count" },
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
  [BlockId.WheatStage3]: "wheat_harvested"
};

const RECIPE_BY_ID = new Map(RECIPES.map((recipe) => [recipe.id, recipe]));

function bump(state: GameState, id: string, by = 1): void {
  state.stats.set(id, (state.stats.get(id) ?? 0) + by);
}

/**
 * Folds one gameplay event into the stat counters. Called for every event the
 * engine emits (the `advancementUnlocked` event is guarded out upstream so this
 * never recurses). Unknown / irrelevant event types are simply ignored.
 */
export function recordEvent(state: GameState, event: GameEvent): void {
  switch (event.type) {
    case "blockBroken": {
      bump(state, "blocks_mined");
      const mined = MINED_STAT_BY_BLOCK[event.blockId];
      if (mined) bump(state, mined);
      break;
    }
    case "mobDied":
      if (HOSTILE_MOB_KINDS.has(event.kind)) bump(state, "hostiles_killed");
      break;
    case "mobBred":
      bump(state, "animals_bred");
      break;
    case "enchanted":
      bump(state, "items_enchanted");
      break;
    case "drankPotion":
      bump(state, "potions_drunk");
      break;
    case "fishingCaught":
      bump(state, "fish_caught");
      break;
    case "bowFired":
      bump(state, "arrows_fired");
      break;
    case "sleepStarted":
      bump(state, "sleeps");
      break;
    case "bossDefeated":
      bump(state, "boss_defeated");
      break;
    case "died":
      bump(state, "deaths");
      break;
    case "jumped":
      bump(state, "jumps");
      break;
    case "crafted": {
      const recipe = RECIPE_BY_ID.get(event.recipeId);
      if (!recipe) break;
      bump(state, "items_crafted");
      bump(state, `crafted_${recipe.id}`);
      // "Tool Up" wants any pickaxe (7 tiers, 7 recipes), so aggregate them.
      if (recipe.result.slotId.endsWith("_pickaxe")) bump(state, "pickaxes_crafted");
      // A villager trade is a station-gated recipe — drive the trade advancement.
      if (recipe.station === "villager") bump(state, "villager_trades");
      break;
    }
  }
}

/**
 * Accumulates the per-frame display counters: seconds of active play and blocks
 * travelled. No advancement depends on these, so they stay out of recordEvent
 * (and the unlock path) — the engine calls this each active step.
 */
export function recordTick(state: GameState, dt: number, horizontalDistance: number): void {
  bump(state, "play_time", dt);
  bump(state, "distance_walked", horizontalDistance);
}

// --- Advancements ---

/** The section an advancement falls under in the Advancements tab grid. */
export type AdvancementCategory = "Mining" | "Crafting" | "Combat" | "Farming" | "Magic" | "Adventure";

/** Fixed display order for the Advancements grid; empty categories are skipped. */
export const ADVANCEMENT_CATEGORY_ORDER: readonly AdvancementCategory[] = ["Mining", "Crafting", "Combat", "Farming", "Magic", "Adventure"];

/**
 * One advancement. Unlock is uniform: `state.stats.get(stat) >= threshold`, so
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
  }
];

/** Lookup by id — used to resolve an unlock's display title for the toast. */
export const ADVANCEMENTS_BY_ID: Record<string, Advancement> = Object.fromEntries(ADVANCEMENTS.map((advancement) => [advancement.id, advancement]));

/**
 * Returns the ids of advancements that just became earnable: not yet unlocked
 * and whose stat has reached its threshold. Pure over the current state, so the
 * engine can add each to `state.advancements` and announce it. Order follows the
 * registry, so the result is deterministic regardless of which event triggered it.
 */
export function evaluateAdvancements(state: GameState): string[] {
  const unlocked: string[] = [];
  for (const advancement of ADVANCEMENTS) {
    if (state.advancements.has(advancement.id)) continue;
    if ((state.stats.get(advancement.stat) ?? 0) >= advancement.threshold) unlocked.push(advancement.id);
  }
  return unlocked;
}
