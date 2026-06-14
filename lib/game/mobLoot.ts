import type { MobKind } from "@/lib/game/types";

/**
 * A single loot entry: yields a uniformly random count in [min, max], gated by
 * an optional drop chance (default: always). Counts are inclusive on both ends.
 */
export type MobDrop = {
  itemId: string;
  min: number;
  max: number;
  /** 0..1 probability the entry drops at all; omitted means always. */
  chance?: number;
};

/**
 * What each mob drops when it dies. Hostiles yield crafting/combat materials,
 * passives yield materials plus raw meat. Item ids must exist in ITEM_DEFS —
 * mobLoot.test.ts enforces that.
 */
export const MOB_DROPS: Record<MobKind, MobDrop[]> = {
  sheep: [
    { itemId: "wool", min: 1, max: 2 },
    { itemId: "raw_mutton", min: 1, max: 1 }
  ],
  chicken: [
    { itemId: "feather", min: 0, max: 2 },
    { itemId: "raw_chicken", min: 1, max: 1 }
  ],
  horse: [{ itemId: "leather", min: 1, max: 2 }],
  cow: [
    { itemId: "leather", min: 1, max: 2 },
    { itemId: "raw_beef", min: 1, max: 1 }
  ],
  pig: [{ itemId: "raw_porkchop", min: 1, max: 1 }],
  zombie: [{ itemId: "rotten_flesh", min: 1, max: 2 }],
  skeleton: [{ itemId: "bone", min: 1, max: 2 }],
  spider: [{ itemId: "string", min: 0, max: 2 }],
  boss: [
    { itemId: "dragon_heart", min: 1, max: 1 },
    { itemId: "diamond_ore", min: 2, max: 4 }
  ]
};

/** Clamps an rng sample into [0, 1) so a pathological injected rng can't over-roll. */
const clampUnit = (v: number): number => Math.min(1 - Number.EPSILON, Math.max(0, v));

/**
 * Rolls the drop table for a mob kind. Returns one entry per item that yielded a
 * positive count; the engine adds each to the inventory. `rng` is injectable so
 * tests get deterministic counts (0 → min, ~1 → max).
 */
export function rollMobDrops(kind: MobKind, rng: () => number): Array<{ itemId: string; count: number }> {
  const drops: Array<{ itemId: string; count: number }> = [];
  for (const entry of MOB_DROPS[kind]) {
    if (entry.chance !== undefined && clampUnit(rng()) >= entry.chance) continue;
    const span = entry.max - entry.min + 1;
    const count = entry.min + Math.floor(clampUnit(rng()) * span);
    if (count > 0) drops.push({ itemId: entry.itemId, count });
  }
  return drops;
}
