import { rollTieredLoot, type LootDrop, type LootEntry, type LootTier } from "@/lib/game/dungeonLoot";

/**
 * Nether fortress chest loot — the same tiered shape as dungeon chests (see
 * dungeonLoot.ts), themed to the dimension: fortress salvage, light and fuel,
 * and a rare tier worth crossing a lava sea for. Obsidian is the thematic
 * portal-repair kit (the frame material, otherwise a diamond-pickaxe grind),
 * and redstone dust ties the worldgen batch together — a fortress raid can
 * fund a circuit without an overworld ore dig. Item ids must exist in
 * ITEM_DEFS — fortressLoot.test.ts enforces that.
 */
export const FORTRESS_LOOT: Record<LootTier, LootEntry[]> = {
  common: [
    // Brick always drops — salvage from the walls, so no chest is ever empty.
    { itemId: "nether_brick", min: 2, max: 6 },
    { itemId: "glowstone_dust", min: 1, max: 4, chance: 0.6 },
    { itemId: "gold_ore", min: 1, max: 3, chance: 0.45 },
    { itemId: "coal", min: 2, max: 5, chance: 0.55 },
    { itemId: "bread", min: 1, max: 3, chance: 0.5 },
    { itemId: "redstone", min: 4, max: 8, chance: 0.35 }
  ],
  rare: [
    { itemId: "blazite_ore", min: 1, max: 2, chance: 0.3 },
    { itemId: "obsidian", min: 1, max: 3, chance: 0.35 },
    { itemId: "diamond_ore", min: 1, max: 2, chance: 0.25 },
    { itemId: "sapphire_sword", min: 1, max: 1, chance: 0.15 }
  ]
};

/** Rolls one fortress chest (see dungeonLoot.rollTieredLoot). */
export function rollFortressLoot(rng: () => number): LootDrop[] {
  return rollTieredLoot(FORTRESS_LOOT, rng);
}
