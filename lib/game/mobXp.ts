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
  // Companions yield no XP — paired with their empty drop tables, killing a pet
  // (or a wild wolf/cat) is never rewarded, so they can't be farmed.
  wolf: 0,
  cat: 0,
  // A villager is a trade NPC — no combat reward (and you shouldn't be killing it).
  villager: 0,
  zombie: 5,
  skeleton: 5,
  spider: 5,
  creeper: 5,
  raider: 6,
  boss: 200
};

export function xpForMob(kind: MobKind): number {
  return MOB_XP[kind];
}
