import { TICK_SECONDS } from "@/lib/game/engine/tickDriver";

/**
 * Client-side server-clock estimation from ping/pong pairs: an EWMA over RTT
 * and clock offset, robust to jitter. The interpolation buffers sample
 * "server time minus ~125ms", so all this needs to be is smooth and roughly
 * right — not NTP.
 */
export type ClockSync = {
  /** Feed one pong (echoes the ping's send time + the server's tick). */
  onPong(sentMs: number, nowMs: number, serverTick: number): void;
  /** Estimated server timeline position (ms on the tick clock) at local `nowMs`. */
  estimatedServerTimeMs(nowMs: number): number;
  /** Smoothed round-trip time (ms); 0 before the first pong. */
  rttMs(): number;
  /** True once at least one pong has been folded in. */
  ready(): boolean;
};

export function createClockSync(alpha = 0.2): ClockSync {
  let rtt = 0;
  let offset = 0; // serverTimeMs - localMs
  let samples = 0;

  return {
    onPong(sentMs, nowMs, serverTick) {
      const sampleRtt = Math.max(0, nowMs - sentMs);
      const serverMs = serverTick * TICK_SECONDS * 1000;
      // The pong left the server ~rtt/2 before it arrived here.
      const sampleOffset = serverMs + sampleRtt / 2 - nowMs;
      if (samples === 0) {
        rtt = sampleRtt;
        offset = sampleOffset;
      } else {
        rtt = rtt * (1 - alpha) + sampleRtt * alpha;
        offset = offset * (1 - alpha) + sampleOffset * alpha;
      }
      samples += 1;
    },
    estimatedServerTimeMs(nowMs) {
      return nowMs + offset;
    },
    rttMs() {
      return rtt;
    },
    ready() {
      return samples > 0;
    }
  };
}
