/**
 * Per-tick history of authoritative mob positions, for melee lag compensation:
 * when a high-ping player attacks, the room resolves each mob where THAT
 * player saw it (their stamped view tick), not where it stands now.
 *
 * A fixed ring keyed by `tick % depth`: each slot holds the tick it was
 * written for plus parallel arrays (id/x/y/z) reused across writes, so the
 * steady state allocates nothing. Queries happen only on attack clicks, so a
 * linear id scan per slot is plenty.
 */

import { MELEE_REWIND_MAX_MS } from "@/lib/game/config";
import { TICK_SECONDS } from "@/lib/game/engine/tickDriver";

/** Ticks the rewind clamp allows (18 at 900 ms / 50 ms ticks). */
export const MELEE_REWIND_MAX_TICKS = Math.round(MELEE_REWIND_MAX_MS / (TICK_SECONDS * 1000));

/** Ring depth: the full rewind window plus slack for the recording tick itself. */
export const MOB_HISTORY_DEPTH = MELEE_REWIND_MAX_TICKS + 6;

type HistorySlot = {
  tick: number;
  count: number;
  ids: number[];
  xs: number[];
  ys: number[];
  zs: number[];
};

export type MobPoseHistory = {
  /** Record every mob's position for `tick` (call once per tick, post-step). */
  record(tick: number, mobs: ReadonlyArray<{ id: number; position: { x: number; y: number; z: number } }>): void;
  /** The recorded position of `mobId` at `tick`, or null when out of window / unknown. */
  positionAt(tick: number, mobId: number): { x: number; y: number; z: number } | null;
};

export function createMobPoseHistory(depth = MOB_HISTORY_DEPTH): MobPoseHistory {
  const slots: HistorySlot[] = Array.from({ length: depth }, () => ({ tick: -1, count: 0, ids: [], xs: [], ys: [], zs: [] }));

  return {
    record(tick, mobs) {
      const slot = slots[((tick % depth) + depth) % depth];
      slot.tick = tick;
      slot.count = mobs.length;
      for (let i = 0; i < mobs.length; i += 1) {
        const mob = mobs[i];
        slot.ids[i] = mob.id;
        slot.xs[i] = mob.position.x;
        slot.ys[i] = mob.position.y;
        slot.zs[i] = mob.position.z;
      }
    },

    positionAt(tick, mobId) {
      const slot = slots[((tick % depth) + depth) % depth];
      if (slot.tick !== tick) return null; // never recorded, or evicted by the ring
      for (let i = 0; i < slot.count; i += 1) {
        if (slot.ids[i] === mobId) return { x: slot.xs[i], y: slot.ys[i], z: slot.zs[i] };
      }
      return null; // mob didn't exist at that tick
    }
  };
}
