import { BURIED_TREASURE_LOOT } from "@/lib/game/buriedTreasureLoot";
import { DUNGEON_LOOT } from "@/lib/game/dungeonLoot";
import { FISHING_LOOT } from "@/lib/game/fishingLoot";
import { SHIPWRECK_LOOT } from "@/lib/game/shipwreckLoot";
import { BLOCK_TO_SLOT, ITEM_DEF_BY_ID } from "@/lib/game/items";
import { MOB_DROPS } from "@/lib/game/mobLoot";
import { RECIPES } from "@/lib/game/recipes";
import type { MobKind, Recipe } from "@/lib/game/types";

/**
 * "How to obtain" hints for the recipe book: when a recipe is short an
 * ingredient, the tooltip tells the player where that item comes from. Hints are
 * derived once from the existing static loot/recipe tables — no new data — so a
 * new item or recipe is covered automatically (special block drops aside).
 */

/** Verb for a craftable item, keyed by the station its recipe needs ("none" = plain crafting). */
const CRAFT_VERB: Record<"none" | NonNullable<Recipe["station"]>, string> = {
  none: "Craft it",
  furnace: "Smelt it",
  villager: "Trade for it",
  brewing: "Brew it"
};

/** Display names for mobs, used in "Hunt <mob>" hints. */
const MOB_LABELS: Record<MobKind, string> = {
  sheep: "a sheep",
  chicken: "a chicken",
  horse: "a horse",
  cow: "a cow",
  pig: "a pig",
  wolf: "a wolf",
  cat: "a cat",
  cod: "a cod",
  salmon: "a salmon",
  drowned: "a drowned",
  zombie: "a zombie",
  skeleton: "a skeleton",
  spider: "a spider",
  creeper: "a creeper",
  raider: "a raider",
  villager: "a villager",
  boss: "the boss",
  imp: "an imp",
  scorcher: "a scorcher"
};

/**
 * Overrides for items whose dropped form differs from the block you break, so the
 * generic "Mine <item label>" reads correctly (coal comes from coal ore;
 * saplings/seeds/wheat are chance drops handled in `rollBlockDrops`, not direct).
 */
const MINE_OVERRIDES: Record<string, string> = {
  coal: "Mine coal ore",
  // Dust drops from deep redstone ore; the BLOCK_TO_SLOT path that would
  // otherwise name it only covers breaking your own placed wire.
  redstone: "Mine redstone ore",
  sapling: "Break leaves",
  seeds: "Break grass",
  wheat: "Harvest grown wheat"
};

const labelFor = (itemId: string): string => ITEM_DEF_BY_ID[itemId]?.label ?? itemId;

/**
 * itemId → single best "how to obtain" hint, precomputed once from the static
 * tables. Priority is chosen so each item points at its most natural, repeatable
 * source: hunt a common mob (not the one-off boss) → craft → mine → shipwreck →
 * fish → dungeon/buried chest → boss. Hunting comes before crafting so a raw drop like wool says "hunt a
 * sheep" rather than the obscure craft-from-string path; the boss is last so its
 * drops (e.g. diamond ore) prefer mining and only surface the boss for its
 * trophy. The first source set for an item wins.
 */
const SOURCE_HINTS: Map<string, string> = (() => {
  const hints = new Map<string, string>();
  const set = (itemId: string, hint: string): void => {
    if (!hints.has(itemId)) hints.set(itemId, hint);
  };

  // 1. Hunt (every mob except the boss — it isn't a farmable source). Entries
  // behind a `chance` gate are lucky extras, not the item's natural source
  // (the drowned's rare spear shouldn't beat "Craft it"), so they don't hint.
  for (const [kind, drops] of Object.entries(MOB_DROPS)) {
    if (kind === "boss") continue;
    for (const drop of drops) {
      if (drop.chance !== undefined) continue;
      set(drop.itemId, `Hunt ${MOB_LABELS[kind as MobKind]}`);
    }
  }
  // 2. Craft (incl. smelt/trade/brew). The first recipe producing the item wins.
  for (const recipe of RECIPES) set(recipe.result.slotId, CRAFT_VERB[recipe.station ?? "none"]);
  // 2b. Fluids: filled buckets come from using an empty bucket on the world.
  set("water_bucket", "Scoop up water with a bucket");
  set("lava_bucket", "Scoop up lava with a bucket");
  // 3. Mine (direct block drops, then chance-drop overrides not in BLOCK_TO_SLOT).
  for (const itemId of Object.values(BLOCK_TO_SLOT)) {
    if (itemId) set(itemId, MINE_OVERRIDES[itemId] ?? `Mine ${labelFor(itemId)}`);
  }
  for (const [itemId, hint] of Object.entries(MINE_OVERRIDES)) set(itemId, hint);
  // 4. Shipwreck chests — before fishing, so the treasure map (also a rare
  // catch) points at its main, repeatable source: diving wrecks.
  for (const tier of Object.values(SHIPWRECK_LOOT)) {
    for (const entry of tier) set(entry.itemId, "Find it in a shipwreck");
  }
  // 5. Fish.
  for (const entry of FISHING_LOOT) set(entry.itemId, "Catch it while fishing");
  // 6. Dungeon and buried-treasure chests.
  for (const tier of Object.values(DUNGEON_LOOT)) {
    for (const entry of tier) set(entry.itemId, "Find it in a dungeon chest");
  }
  for (const tier of Object.values(BURIED_TREASURE_LOOT)) {
    for (const entry of tier) set(entry.itemId, "Dig up buried treasure");
  }
  // 7. Boss (last resort — only its trophy drops with no other source reach here).
  for (const drop of MOB_DROPS.boss) set(drop.itemId, "Defeat the boss");
  return hints;
})();

/** A short, human "how to obtain" hint for an item, or null when its source is unknown. */
export function itemSourceHint(itemId: string): string | null {
  return SOURCE_HINTS.get(itemId) ?? null;
}
