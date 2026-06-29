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
