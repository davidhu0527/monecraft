import type { MobDrop } from "@/lib/game/mobLoot";

/**
 * Dungeon chest loot, mirroring the mob/block drop-table pattern
 * (`{ itemId, min, max, chance? }` entries rolled for an inclusive count).
 *
 * A chest rolls a tier first: most are `common` (staples — food, low ores, a
 * starter tool), a minority are `rare` and additionally roll the standout
 * payoff table (high ores, mid-tier gear). Rare chests still get the common
 * roll on top, so they are never *worse* than a common chest. Item ids must
 * exist in ITEM_DEFS — dungeonLoot.test.ts enforces that.
 */
export type LootEntry = MobDrop;
export type LootTier = "common" | "rare";

/** Probability a chest rolls the rare tier (on top of the common roll). */
export const RARE_CHEST_CHANCE = 0.25;

export const DUNGEON_LOOT: Record<LootTier, LootEntry[]> = {
  common: [
    // Bone always drops, so every dungeon chest holds at least something.
    { itemId: "bone", min: 1, max: 3 },
    { itemId: "bread", min: 1, max: 3, chance: 0.8 },
    { itemId: "cooked_chicken", min: 1, max: 2, chance: 0.5 },
    { itemId: "string", min: 0, max: 2 },
    { itemId: "seeds", min: 0, max: 2 },
    { itemId: "sliver_ore", min: 1, max: 3, chance: 0.4 },
    { itemId: "gold_ore", min: 1, max: 3, chance: 0.4 },
    { itemId: "stone_pickaxe", min: 1, max: 1, chance: 0.25 }
  ],
  rare: [
    { itemId: "diamond_ore", min: 1, max: 2, chance: 0.3 },
    { itemId: "sapphire_ore", min: 1, max: 2, chance: 0.35 },
    { itemId: "ruby_sword", min: 1, max: 1, chance: 0.15 },
    { itemId: "sapphire_sword", min: 1, max: 1, chance: 0.15 },
    { itemId: "helmet", min: 1, max: 1, chance: 0.2 },
    { itemId: "chestplate", min: 1, max: 1, chance: 0.2 },
    { itemId: "diamond_pickaxe", min: 1, max: 1, chance: 0.08 }
  ]
};

/** Clamps an rng sample into [0, 1) so a pathological injected rng can't over-roll. */
const clampUnit = (v: number): number => Math.min(1 - Number.EPSILON, Math.max(0, v));

/**
 * A small mulberry32 PRNG. Dungeon chests are filled lazily on first open, so
 * the loot must be reproducible from a stable seed (the world seed mixed with
 * the chest's voxel index) until the chest is actually opened — otherwise the
 * same chest would roll different loot before vs after a reload.
 */
export function seededRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function rollEntries(entries: LootEntry[], rng: () => number): Array<{ itemId: string; count: number }> {
  const drops: Array<{ itemId: string; count: number }> = [];
  for (const entry of entries) {
    if (entry.chance !== undefined && clampUnit(rng()) >= entry.chance) continue;
    const span = entry.max - entry.min + 1;
    const count = entry.min + Math.floor(clampUnit(rng()) * span);
    if (count > 0) drops.push({ itemId: entry.itemId, count });
  }
  return drops;
}

/**
 * Rolls one dungeon chest. Consumes one rng sample for the tier, then rolls the
 * common table (always) plus the rare table when the chest is rare. `rng` is
 * injectable so tests get deterministic loot (and the engine seeds it per chest).
 */
export function rollDungeonLoot(rng: () => number): Array<{ itemId: string; count: number }> {
  const rare = clampUnit(rng()) < RARE_CHEST_CHANCE;
  const drops = rare ? rollEntries(DUNGEON_LOOT.rare, rng) : [];
  drops.push(...rollEntries(DUNGEON_LOOT.common, rng));
  return drops;
}
