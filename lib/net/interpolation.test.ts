import { describe, expect, test } from "bun:test";
import { createPoseBuffer, lerpAngle } from "./interpolation";

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
