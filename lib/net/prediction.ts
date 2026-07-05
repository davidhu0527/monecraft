/**
 * The prediction ledger: bookkeeping for optimistic block edits on a replica.
 * A predicted edit is applied to the replica world IMMEDIATELY (that's the
 * whole point — a placed block appears at click time, not a round-trip
 * later); this module only remembers what was predicted so the server's
 * authoritative block journal can confirm it, override it, or — if neither
 * arrives in time — expire it for revert. Pure data structure: it never
 * touches the world itself, and the caller owns all clocks.
 *
 * Reconciliation policy (deliberately simple; the server's inventory delta
 * is the ultimate safety net): ANY journal write to a cell resolves every
 * prediction touching that cell — a matching value confirms that edit, a
 * different one drops the whole prediction and surfaces its refund. This
 * also guarantees a revert never restores a `prev` that a server write has
 * since invalidated.
 */

export type PredictedEdit = { idx: number; block: number; prev: number; confirmed: boolean };

export type PredictionRefund = { itemId: string; count: number };

export type Prediction = {
  id: number;
  kind: "place" | "break";
  /** Every cell the prediction wrote (a door is 2, a kelp stalk n). */
  edits: PredictedEdit[];
  /** What to hand back if the server rejects a place (null in creative). */
  refund: PredictionRefund | null;
  deadlineMs: number;
};

/** Revert no sooner than this — a momentary RTT dip must not flicker blocks. */
export const PREDICTION_TIMEOUT_MIN_MS = 1000;
/** …and no later: past this the player deserves the truth. */
export const PREDICTION_TIMEOUT_MAX_MS = 5000;
/** 2×RTT covers the cmd up + journal back, +200 for a tick of server skew. */
export const predictionTimeoutMs = (rttMs: number): number => Math.min(PREDICTION_TIMEOUT_MAX_MS, Math.max(PREDICTION_TIMEOUT_MIN_MS, 2 * rttMs + 200));

/**
 * The own-echo suppression window outlives the prediction entry itself: the
 * echo event rides the SAME tick that confirms (applyBlocks runs before the
 * ev loop), and a late echo after a timeout-revert must still not re-toast.
 */
export const ECHO_SUPPRESS_EXTRA_MS = 3000;

export type JournalResolution = { refunds: PredictionRefund[] };

export type PredictionLedger = {
  add(
    kind: Prediction["kind"],
    edits: Array<{ idx: number; block: number; prev: number }>,
    refund: PredictionRefund | null,
    nowMs: number,
    rttMs: number
  ): void;
  /** Feed one authoritative journal write. Never mutates the world. */
  onJournal(idx: number, block: number): JournalResolution;
  /** Predictions past their deadline, newest-first (revert in reverse application order). Removes them. */
  expire(nowMs: number): Prediction[];
  /** Should the client swallow its own blockPlaced/blockBroken echo at this cell? */
  shouldSuppress(idx: number, nowMs: number): boolean;
  /** Forget everything (a world-sync is a full keyframe — nothing pending survives it). */
  clear(): void;
  /** Pending (unretired) predictions — for the F3 overlay. */
  size(): number;
};

export function createPredictionLedger(): PredictionLedger {
  let nextId = 1;
  const pending: Prediction[] = [];
  /** idx → suppress-until (ms); survives confirm/retire on purpose. */
  const suppressUntil = new Map<number, number>();

  const retire = (prediction: Prediction): void => {
    const at = pending.indexOf(prediction);
    if (at >= 0) pending.splice(at, 1);
  };

  return {
    add(kind, edits, refund, nowMs, rttMs) {
      if (edits.length === 0) return;
      const deadlineMs = nowMs + predictionTimeoutMs(rttMs);
      pending.push({ id: nextId++, kind, edits: edits.map((e) => ({ ...e, confirmed: false })), refund, deadlineMs });
      for (const e of edits) suppressUntil.set(e.idx, Math.max(suppressUntil.get(e.idx) ?? 0, deadlineMs + ECHO_SUPPRESS_EXTRA_MS));
    },

    onJournal(idx, block) {
      const refunds: PredictionRefund[] = [];
      for (const prediction of [...pending]) {
        const touched = prediction.edits.find((e) => e.idx === idx);
        if (!touched) continue;
        if (touched.block === block) {
          touched.confirmed = true;
          if (prediction.edits.every((e) => e.confirmed)) retire(prediction);
        } else {
          // The server wrote something else here: the prediction lost (a
          // race, a rejection). Drop it whole — its other cells will be
          // rewritten by the server's own journal or reverted by nothing,
          // and the world already shows this cell's authoritative value
          // (the caller applies the journal regardless).
          retire(prediction);
          if (prediction.refund) refunds.push(prediction.refund);
        }
      }
      return { refunds };
    },

    expire(nowMs) {
      const expired = pending.filter((p) => p.deadlineMs <= nowMs);
      for (const p of expired) retire(p);
      return expired.sort((a, b) => b.id - a.id);
    },

    shouldSuppress(idx, nowMs) {
      const until = suppressUntil.get(idx);
      if (until === undefined) return false;
      if (nowMs > until) {
        suppressUntil.delete(idx);
        return false;
      }
      return true;
    },

    clear() {
      pending.length = 0;
      suppressUntil.clear();
    },

    size: () => pending.length
  };
}
