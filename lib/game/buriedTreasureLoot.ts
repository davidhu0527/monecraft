import { rollTieredLoot, type LootDrop, type LootEntry, type LootTier } from "@/lib/game/dungeonLoot";

/**
 * Buried-treasure chest loot — the payoff at the end of a treasure-map hunt,
 * so the richest of the tiered worldgen tables (see dungeonLoot.ts): emeralds
 * always, high ores often, and a rare-tier shot at end-game gear. Item ids
 * must exist in ITEM_DEFS — buriedTreasureLoot.test.ts enforces that.
 */
export const BURIED_TREASURE_LOOT: Record<LootTier, LootEntry[]> = {
  common: [
    // Emeralds always drop — a dug-up hoard is never empty-handed.
    { itemId: "emerald", min: 2, max: 5 },
    { itemId: "gold_ore", min: 1, max: 4, chance: 0.6 },
    { itemId: "diamond_ore", min: 1, max: 2, chance: 0.4 },
    { itemId: "sapphire_ore", min: 1, max: 3, chance: 0.45 },
    { itemId: "cooked_fish", min: 1, max: 3, chance: 0.4 },
    { itemId: "arrow", min: 4, max: 10, chance: 0.4 }
  ],
  rare: [
    { itemId: "diamond_ore", min: 2, max: 4, chance: 0.6 },
    { itemId: "gold_sword", min: 1, max: 1, chance: 0.2 },
    { itemId: "chestplate", min: 1, max: 1, chance: 0.25 },
    { itemId: "diamond_pickaxe", min: 1, max: 1, chance: 0.12 }
  ]
};

/** Rolls one buried-treasure chest (see dungeonLoot.rollTieredLoot). */
export function rollBuriedTreasureLoot(rng: () => number): LootDrop[] {
  return rollTieredLoot(BURIED_TREASURE_LOOT, rng);
}
