import { TICK_SECONDS } from "@/lib/game/engine/tickDriver";

/**
 * Client-side server-clock estimation from ping/pong pairs. RTT is an EWMA
 * (display + prediction timeouts want "typical", not "best"). The OFFSET is
 * NTP-style: of the recent pongs, trust the one with the lowest RTT — the
 * sample least inflated by queueing, whose half-RTT split is most honest.
 * A pure EWMA offset wobbles with every jittery pong, and the interpolation
 * render clock wobbles with it; the min-RTT pick stays put. The applied
 * offset slews toward the target (no visible time-warp) and snaps only on
 * big discontinuities (first sample, reconnect).
 */
export type ClockSync = {
  /** Feed one pong (echoes the ping's send time + the server's tick). */
  onPong(sentMs: number, nowMs: number, serverTick: number): void;
  /** Estimated server timeline position (ms on the tick clock) at local `nowMs`. Advances the slew — call it with monotonic times. */
  estimatedServerTimeMs(nowMs: number): number;
  /** Smoothed round-trip time (ms); 0 before the first pong. */
  rttMs(): number;
  /** True once at least one pong has been folded in. */
  ready(): boolean;
};

/** Pong samples considered for the min-RTT offset pick (16 × 1 s ping cadence ≈ 16 s of memory). */
export const OFFSET_WINDOW_SIZE = 16;
/** How fast the applied offset chases the target (ms of correction per second). */
export const OFFSET_SLEW_MS_PER_SEC = 40;
/** Offset error beyond this snaps instead of slewing (reconnects, first fix). */
export const OFFSET_SNAP_MS = 250;

export function createClockSync(alpha = 0.2): ClockSync {
  let rtt = 0;
  let samples = 0;
  /** Recent {rtt, offset} pairs (offset = serverTimeMs - localMs). */
  const window: Array<{ rtt: number; offset: number }> = [];
  let targetOffset = 0;
  let appliedOffset = 0;
  let lastSlewMs: number | null = null;

  return {
    onPong(sentMs, nowMs, serverTick) {
      const sampleRtt = Math.max(0, nowMs - sentMs);
      const serverMs = serverTick * TICK_SECONDS * 1000;
      // The pong left the server ~rtt/2 before it arrived here.
      const sampleOffset = serverMs + sampleRtt / 2 - nowMs;
      rtt = samples === 0 ? sampleRtt : rtt * (1 - alpha) + sampleRtt * alpha;
      window.push({ rtt: sampleRtt, offset: sampleOffset });
      if (window.length > OFFSET_WINDOW_SIZE) window.shift();
      let best = window[0];
      for (const s of window) if (s.rtt < best.rtt) best = s;
      targetOffset = best.offset;
      if (samples === 0) appliedOffset = targetOffset;
      samples += 1;
    },

    estimatedServerTimeMs(nowMs) {
      const error = targetOffset - appliedOffset;
      if (Math.abs(error) > OFFSET_SNAP_MS) {
        appliedOffset = targetOffset;
      } else if (lastSlewMs !== null) {
        const step = (OFFSET_SLEW_MS_PER_SEC * Math.max(0, nowMs - lastSlewMs)) / 1000;
        appliedOffset += Math.sign(error) * Math.min(Math.abs(error), step);
      }
      lastSlewMs = nowMs;
      return nowMs + appliedOffset;
    },

    rttMs() {
      return rtt;
    },

    ready() {
      return samples > 0;
    }
  };
}
