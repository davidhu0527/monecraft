import type { PushResult } from "@/lib/game/cloudSaves";
import type { SaveData } from "@/lib/game/types";

/**
 * Serializes a cloud-linked world's save uploads: one push in flight, the
 * newest snapshot queued behind it.
 *
 * Six call sites push (autosave, the three unload listeners, hardcore game-over,
 * unmount, manual save) and several fire together — backgrounding a phone raises
 * `visibilitychange` AND `pagehide`. Unqueued, those raced with the same base
 * revision: the server accepted one and 409'd the other, and since a conflict
 * latches syncing off for the session, a device switched off its own cloud sync
 * by conflicting with ITSELF.
 *
 * Latest-wins: a snapshot queued while a push is in flight replaces any earlier
 * one — they describe the same world, so only the newest is worth sending. Same
 * shape as the save store's per-world write queue (lib/game/saveStore.ts),
 * deliberately: different resource, different failure mode (a 409 latch rather
 * than a retry), so they don't share an implementation.
 */
export type CloudPushQueue = {
  /** Queue a snapshot for upload, replacing any still waiting. */
  enqueue(save: SaveData, notify: boolean): void;
  /** Whether a push is in flight or waiting — for tests and diagnostics. */
  idle(): boolean;
};

export function createCloudPushQueue(deps: {
  push: (save: SaveData) => Promise<PushResult>;
  /** Called once when the server rejects a push as stale. `notify` if any coalesced snapshot asked to warn. */
  onConflict: (notify: boolean) => void;
  /** Stop draining (the conflict latch) — checked between pushes, so an in-flight one still finishes. */
  stopped: () => boolean;
}): CloudPushQueue {
  let inFlight = false;
  let pending: { save: SaveData; notify: boolean } | null = null;

  const drain = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      while (pending && !deps.stopped()) {
        const { save, notify } = pending;
        pending = null;
        if ((await deps.push(save)) === "conflict") deps.onConflict(notify);
      }
    } finally {
      inFlight = false;
    }
  };

  return {
    enqueue(save, notify) {
      if (deps.stopped()) return;
      // `notify` sticks across coalescing: dropping a superseded snapshot must
      // not drop the warning that it would have carried.
      pending = { save, notify: notify || (pending?.notify ?? false) };
      void drain();
    },
    idle: () => !inFlight && pending === null
  };
}
