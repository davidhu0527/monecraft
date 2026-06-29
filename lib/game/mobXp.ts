import type { MobKind } from "@/lib/game/types";

/**
 * XP granted for killing each mob kind. Hostiles reward more than passives, and
 * the boss is a jackpot. Mirrors `mobLoot.ts`; the exhaustive `Record<MobKind>`
 * means a new mob can't silently grant no XP, and `xp.test.ts` checks the shape.
 */
export const MOB_XP: Record<MobKind, number> = {
  sheep: 1,
  chicken: 1,
  horse: 2,
  cow: 2,
  pig: 1,
  wolf: 1,
  cat: 1,
  // A villager is a trade NPC — no combat reward (and you shouldn't be killing it).
  villager: 0,
  zombie: 5,
  skeleton: 5,
  spider: 5,
  creeper: 5,
  boss: 200
};

export function xpForMob(kind: MobKind): number {
  return MOB_XP[kind];
}
