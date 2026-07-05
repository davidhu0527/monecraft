import { rollTieredLoot, type LootDrop, type LootEntry, type LootTier } from "@/lib/game/dungeonLoot";

/**
 * Shipwreck chest loot — the same tiered shape as dungeon chests (see
 * dungeonLoot.ts), themed nautical: trade goods, sailcloth materials, and the
 * treasure map that starts the buried-treasure hunt. Wrecks are the map's main
 * source, so it sits in the common table. Item ids must exist in ITEM_DEFS —
 * shipwreckLoot.test.ts enforces that.
 */
export const SHIPWRECK_LOOT: Record<LootTier, LootEntry[]> = {
  common: [
    // Planks always drop — salvage from the hull, so no chest is ever empty.
    { itemId: "planks", min: 2, max: 6 },
    { itemId: "treasure_map", min: 1, max: 1, chance: 0.4 },
    { itemId: "emerald", min: 1, max: 3, chance: 0.55 },
    { itemId: "string", min: 1, max: 3, chance: 0.7 },
    { itemId: "leather", min: 1, max: 2, chance: 0.5 },
    { itemId: "raw_fish", min: 1, max: 3, chance: 0.6 },
    { itemId: "dried_kelp", min: 1, max: 4, chance: 0.45 },
    { itemId: "gold_ore", min: 1, max: 3, chance: 0.3 }
  ],
  rare: [
    { itemId: "diamond_ore", min: 1, max: 2, chance: 0.25 },
    { itemId: "sapphire_ore", min: 1, max: 2, chance: 0.35 },
    { itemId: "bow", min: 1, max: 1, chance: 0.25 },
    { itemId: "sapphire_sword", min: 1, max: 1, chance: 0.15 },
    { itemId: "boots", min: 1, max: 1, chance: 0.2 }
  ]
};

/** Rolls one shipwreck chest (see dungeonLoot.rollTieredLoot). */
export function rollShipwreckLoot(rng: () => number): LootDrop[] {
  return rollTieredLoot(SHIPWRECK_LOOT, rng);
}
