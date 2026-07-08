import { describe, expect, test } from "bun:test";
import { createClockSync } from "./clock";

/**
 * The min-RTT clock against scripted pongs. Scenario convention: the true
 * relation is serverMs = localMs + 48_000; a pong sent at `s` takes `up` ms to
 * the server (which stamps its tick there) and `down` ms back. The estimator
 * only ever sees (sentMs, nowMs, serverTick) — the asymmetry is what it must
 * survive.
 */

const TRUE_OFFSET = 48_000;

function pong(clock: ReturnType<typeof createClockSync>, sentMs: number, up: number, down: number): void {
  const serverMs = sentMs + up + TRUE_OFFSET;
  if (serverMs % 50 !== 0) throw new Error(`test bug: serverMs ${serverMs} not on a tick`);
  clock.onPong(sentMs, sentMs + up + down, serverMs / 50);
}

describe("clock sync", () => {
  test("seeds from the first pong and keeps rttMs an EWMA", () => {
    const clock = createClockSync();
    expect(clock.ready()).toBe(false);
    pong(clock, 960, 40, 40); // rtt 80, symmetric — offset sample is exact
    expect(clock.ready()).toBe(true);
    expect(clock.rttMs()).toBeCloseTo(80, 5);
    expect(clock.estimatedServerTimeMs(1040)).toBeCloseTo(1040 + TRUE_OFFSET, 5);
    pong(clock, 2010, 40, 440); // rtt 480
    expect(clock.rttMs()).toBeCloseTo(80 * 0.8 + 480 * 0.2, 5);
  });

  test("min-RTT pick holds the offset through asymmetric jitter (where an EWMA drifts)", () => {
    const clock = createClockSync();
    pong(clock, 960, 40, 40); // the one clean sample: rtt 80, zero offset error
    clock.estimatedServerTimeMs(1040);
    // Ten pongs inflated on the return leg only: each carries a -200 ms offset
    // error (rtt/2 mis-split). An EWMA would absorb most of it.
    for (let i = 0; i < 10; i += 1) pong(clock, 2010 + i * 1000, 40, 440);
    const estimate = clock.estimatedServerTimeMs(15_000);
    expect(Math.abs(estimate - (15_000 + TRUE_OFFSET))).toBeLessThan(25);
  });

  test("a small target change slews at OFFSET_SLEW_MS_PER_SEC, not instantly", () => {
    const clock = createClockSync();
    pong(clock, 950, 50, 50); // rtt 100 → applied offset 48_000
    expect(clock.estimatedServerTimeMs(1050)).toBeCloseTo(1050 + 48_000, 5);
    // A new best sample (rtt 80) whose offset lands at 48_100: +100 target
    // shift, under the snap threshold. serverMs = 48_100 - 40 + 2_040 = 50_100.
    clock.onPong(1960, 2040, 50_100 / 50);
    // 40 ms of correction per second: 48_040 after 1 s, 48_080 after 2 s,
    // capped at the 48_100 target on the half-second that overshoots.
    expect(clock.estimatedServerTimeMs(2050)).toBeCloseTo(2050 + 48_040, 5);
    expect(clock.estimatedServerTimeMs(3050)).toBeCloseTo(3050 + 48_080, 5);
    expect(clock.estimatedServerTimeMs(3550)).toBeCloseTo(3550 + 48_100, 5);
    expect(clock.estimatedServerTimeMs(9999)).toBeCloseTo(9999 + 48_100, 5); // stays converged
  });

  test("snaps when the target jumps past OFFSET_SNAP_MS", () => {
    const clock = createClockSync();
    pong(clock, 950, 50, 50);
    clock.estimatedServerTimeMs(1050);
    // New min-RTT sample (rtt 60) with a +400 offset error → snap, not slew.
    clock.onPong(1970, 2030, (2030 + TRUE_OFFSET + 400 - 30) / 50);
    expect(clock.estimatedServerTimeMs(2031)).toBeCloseTo(2031 + TRUE_OFFSET + 400, 5);
  });

  test("the sample window evicts: a stale clean sample eventually stops anchoring", () => {
    const clock = createClockSync();
    pong(clock, 960, 40, 40); // clean anchor
    clock.estimatedServerTimeMs(1040);
    // 16 inflated samples push the clean one out of the 16-slot window; the
    // best remaining sample carries the -200 error, and a large dt lets the
    // slew finish. The estimator follows the best evidence it still has.
    for (let i = 0; i < 16; i += 1) pong(clock, 2010 + i * 1000, 40, 440);
    expect(clock.estimatedServerTimeMs(100_000)).toBeCloseTo(100_000 + TRUE_OFFSET - 200, 5);
  });
});
