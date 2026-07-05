import { describe, expect, test } from "bun:test";
import {
  createDelayController,
  createPoseBuffer,
  DELAY_SLEW_MS_PER_SEC,
  INTERPOLATION_DELAY_MAX_MS,
  INTERPOLATION_DELAY_MIN_MS,
  lerpAngle
} from "./interpolation";

describe("pose interpolation", () => {
  test("lerps position and yaw between bracketing samples", () => {
    const buffer = createPoseBuffer();
    buffer.push({ tMs: 1000, x: 0, y: 64, z: 0, yaw: 0 });
    buffer.push({ tMs: 1050, x: 1, y: 64, z: 2, yaw: 0.4 });
    const mid = buffer.sample(1025)!;
    expect(mid.x).toBeCloseTo(0.5, 9);
    expect(mid.z).toBeCloseTo(1, 9);
    expect(mid.yaw).toBeCloseTo(0.2, 9);
  });

  test("clamps rather than extrapolating on a stalled stream", () => {
    const buffer = createPoseBuffer();
    buffer.push({ tMs: 1000, x: 0, y: 64, z: 0, yaw: 0 });
    buffer.push({ tMs: 1050, x: 5, y: 64, z: 0, yaw: 0 });
    expect(buffer.sample(500)!.x).toBe(0);
    expect(buffer.sample(9999)!.x).toBe(5); // frozen at the last known pose
  });

  test("yaw takes the short way around the wrap", () => {
    expect(lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5)).toBeCloseTo(Math.PI, 5);
    expect(lerpAngle(-Math.PI + 0.1, Math.PI - 0.1, 0.5)).toBeCloseTo(-Math.PI, 5);
    expect(lerpAngle(0.1, 0.3, 0.5)).toBeCloseTo(0.2, 9);
  });

  test("late (older) samples are dropped; duplicate timestamps refresh", () => {
    const buffer = createPoseBuffer();
    buffer.push({ tMs: 1000, x: 0, y: 0, z: 0, yaw: 0 });
    buffer.push({ tMs: 1100, x: 10, y: 0, z: 0, yaw: 0 });
    buffer.push({ tMs: 1050, x: 99, y: 0, z: 0, yaw: 0 }); // stale news — dropped
    expect(buffer.latest()!.x).toBe(10);
    expect(buffer.latest()!.tMs).toBe(1100);
    buffer.push({ tMs: 1100, x: 11, y: 0, z: 0, yaw: 0 }); // refresh in place
    expect(buffer.latest()!.x).toBe(11);
    expect(buffer.sample(1050)!.x).toBeCloseTo(5.5, 9);
  });
});

describe("delay controller", () => {
  test("clean 20 Hz arrivals sit on the floor", () => {
    const ctl = createDelayController();
    for (let n = 1; n <= 40; n += 1) ctl.onTickArrival(n * 50, n);
    expect(ctl.jitterMs()).toBe(0);
    ctl.effectiveDelayMs(2000);
    expect(ctl.effectiveDelayMs(10_000)).toBe(INTERPOLATION_DELAY_MIN_MS);
  });

  test("jittery arrivals raise the delay toward the cap, slew-bounded", () => {
    const ctl = createDelayController();
    // Alternating ±150 ms arrival error: per-gap deviation ~300 ms → target
    // clamps at the max.
    for (let n = 1; n <= 40; n += 1) ctl.onTickArrival(n * 50 + (n % 2 === 0 ? 150 : -150), n);
    expect(ctl.jitterMs()).toBeGreaterThan(200);
    const first = ctl.effectiveDelayMs(10_000);
    expect(first).toBe(INTERPOLATION_DELAY_MIN_MS); // slew starts on the second call
    const oneSecondLater = ctl.effectiveDelayMs(11_000);
    expect(oneSecondLater - first).toBeLessThanOrEqual(DELAY_SLEW_MS_PER_SEC + 1e-9);
    expect(oneSecondLater).toBeGreaterThan(first);
    // Given time, it converges to the cap and stays there.
    expect(ctl.effectiveDelayMs(60_000)).toBe(INTERPOLATION_DELAY_MAX_MS);
    expect(ctl.currentDelayMs()).toBe(INTERPOLATION_DELAY_MAX_MS);
  });

  test("a coalesced burst after a stall counts once (tick-number-aware)", () => {
    const ctl = createDelayController();
    ctl.onTickArrival(500, 10);
    // Frames for ticks 10→12 arriving 100 ms apart is exactly on schedule.
    ctl.onTickArrival(600, 12);
    expect(ctl.jitterMs()).toBe(0);
  });

  test("dupes and reordered ticks are ignored", () => {
    const ctl = createDelayController();
    ctl.onTickArrival(500, 10);
    ctl.onTickArrival(550, 11);
    ctl.onTickArrival(9999, 11); // dupe
    ctl.onTickArrival(9999, 5); // reordered
    expect(ctl.jitterMs()).toBe(0);
  });

  test("reset clears arrival history but keeps the effective delay", () => {
    const ctl = createDelayController();
    for (let n = 1; n <= 40; n += 1) ctl.onTickArrival(n * 50 + (n % 2 === 0 ? 150 : -150), n);
    ctl.effectiveDelayMs(5_000);
    const held = ctl.effectiveDelayMs(20_000);
    expect(held).toBeGreaterThan(INTERPOLATION_DELAY_MIN_MS);
    ctl.reset();
    expect(ctl.currentDelayMs()).toBe(held); // no pop on reconnect
    expect(ctl.jitterMs()).toBe(0);
    // The gap across the reset is not measured as jitter.
    ctl.onTickArrival(100_000, 500);
    ctl.onTickArrival(100_050, 501);
    expect(ctl.jitterMs()).toBe(0);
    // And with a clean window the delay slews back down to the floor.
    ctl.effectiveDelayMs(100_000);
    expect(ctl.effectiveDelayMs(200_000)).toBe(INTERPOLATION_DELAY_MIN_MS);
  });
});
