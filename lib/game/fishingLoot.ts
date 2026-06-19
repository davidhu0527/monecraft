/**
 * The fishing catch table: one weighted pick per bite. Mostly raw fish, sometimes
 * junk (string/bone/seeds/rotten flesh), rarely a treasure (emerald/leather).
 * Weights are relative — summed at roll time — so adding an entry only reweights
 * the odds. Mirrors the other loot rollers' output shape so a catch is added to
 * the inventory the same way (`adjustSlotCount`).
 */

export type FishingLootEntry = {
  itemId: string;
  weight: number;
  min?: number;
  max?: number;
};

export const FISHING_LOOT: FishingLootEntry[] = [
  // Fish — the bulk of every catch table.
  { itemId: "raw_fish", weight: 68, min: 1, max: 1 },
  // Junk.
  { itemId: "string", weight: 8 },
  { itemId: "bone", weight: 7 },
  { itemId: "seeds", weight: 6 },
  { itemId: "rotten_flesh", weight: 5 },
  // Treasure (rare).
  { itemId: "emerald", weight: 3 },
  { itemId: "leather", weight: 3 }
];

const clampUnit = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** One weighted pick from FISHING_LOOT. `rng` is injectable for deterministic tests. */
export function rollFishingCatch(rng: () => number): Array<{ itemId: string; count: number }> {
  const total = FISHING_LOOT.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = clampUnit(rng()) * total;
  for (const entry of FISHING_LOOT) {
    roll -= entry.weight;
    if (roll < 0) {
      const min = entry.min ?? 1;
      const max = entry.max ?? 1;
      const count = min + Math.floor(clampUnit(rng()) * (max - min + 1));
      return [{ itemId: entry.itemId, count }];
    }
  }
  // Floating-point guard: a roll landing exactly at the total falls to the last entry.
  const last = FISHING_LOOT[FISHING_LOOT.length - 1];
  return [{ itemId: last.itemId, count: last.min ?? 1 }];
}
