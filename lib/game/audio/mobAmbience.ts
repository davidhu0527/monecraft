import type { MobKind } from "@/lib/game/types";

/** Mobs farther than this are silent. */
export const MOB_EARSHOT = 24;

/** Seconds between idle calls per kind (min..max, uniform). */
const CALL_INTERVALS: Record<MobKind, readonly [number, number]> = {
  sheep: [6, 14],
  chicken: [5, 12],
  horse: [8, 18],
  cow: [7, 16],
  pig: [5, 13],
  zombie: [4, 9],
  skeleton: [5, 11],
  spider: [4, 10],
  creeper: [6, 13],
  boss: [6, 12]
};

/** Structural subset of the engine's MobState — state.mobs passes directly. */
export type AmbientMob = {
  id: number;
  kind: MobKind;
  position: { x: number; z: number };
};

export type AmbientCall = {
  kind: MobKind;
  /** Distance falloff 0..1. */
  gain: number;
  /** Stereo position -1..1 relative to the player's look direction. */
  pan: number;
};

export type MobAmbienceScheduler = {
  /** Returns calls due this frame. The array is reused — consume immediately. */
  tick(dt: number, mobs: readonly AmbientMob[], playerX: number, playerZ: number, playerYaw: number): readonly AmbientCall[];
};

export function createMobAmbienceScheduler(rng: () => number = Math.random): MobAmbienceScheduler {
  const timers = new Map<number, number>();
  const calls: AmbientCall[] = [];

  const nextInterval = (kind: MobKind): number => {
    const [min, max] = CALL_INTERVALS[kind];
    return min + rng() * (max - min);
  };

  return {
    tick(dt, mobs, playerX, playerZ, playerYaw) {
      calls.length = 0;

      // Despawned mobs leave stale timers behind; sweep once the map outgrows
      // the population instead of allocating an id set every frame.
      if (timers.size > mobs.length + 8) {
        const alive = new Set(mobs.map((mob) => mob.id));
        for (const id of timers.keys()) if (!alive.has(id)) timers.delete(id);
      }

      const rightX = Math.cos(playerYaw);
      const rightZ = -Math.sin(playerYaw);

      for (const mob of mobs) {
        const dx = mob.position.x - playerX;
        const dz = mob.position.z - playerZ;
        const dist = Math.hypot(dx, dz);
        if (dist > MOB_EARSHOT) continue;

        const timer = timers.get(mob.id);
        if (timer === undefined) {
          // First sighting: start a full randomized interval so a spawn wave
          // doesn't open with a chorus.
          timers.set(mob.id, nextInterval(mob.kind));
          continue;
        }
        const remaining = timer - dt;
        if (remaining > 0) {
          timers.set(mob.id, remaining);
          continue;
        }
        timers.set(mob.id, nextInterval(mob.kind));

        const falloff = 1 - dist / MOB_EARSHOT;
        const pan = dist > 0.001 ? Math.max(-1, Math.min(1, (dx * rightX + dz * rightZ) / dist)) : 0;
        calls.push({ kind: mob.kind, gain: falloff * falloff, pan });
      }
      return calls;
    }
  };
}
