import { describe, expect, test } from "bun:test";
import { BASE_POSE, computeHeldPose, EQUIP_MS, SWING_MS } from "@/lib/game/render/heldItemPose";

const REST = { swingStartMs: -Infinity, continuousSwing: false, equipStartMs: -Infinity, moveFactor: 0 };

describe("computeHeldPose", () => {
  test("rests at the base pose when nothing is animating", () => {
    // timeMs 0 keeps the idle-sway sine terms at zero.
    expect(computeHeldPose({ timeMs: 0, ...REST })).toEqual(BASE_POSE);
  });

  test("a one-shot swing peaks mid-arc and returns to base", () => {
    const mid = computeHeldPose({ timeMs: SWING_MS / 2, ...REST, swingStartMs: 0 });
    expect(mid.rotX).toBeLessThan(BASE_POSE.rotX - 0.5);
    expect(mid.posZ).toBeLessThan(BASE_POSE.posZ);

    const after = computeHeldPose({ timeMs: SWING_MS * 1.5, ...REST, swingStartMs: 0 });
    const idle = computeHeldPose({ timeMs: SWING_MS * 1.5, ...REST });
    expect(after).toEqual(idle); // swing fully over, only idle sway remains
  });

  test("continuous swing loops while a one-shot swing does not", () => {
    const looped = computeHeldPose({ timeMs: SWING_MS * 1.5, ...REST, swingStartMs: 0, continuousSwing: true });
    const oneShot = computeHeldPose({ timeMs: SWING_MS * 1.5, ...REST, swingStartMs: 0 });
    expect(looped.rotX).toBeLessThan(oneShot.rotX - 0.5);
  });

  test("equip dips the item below frame and decays to nothing", () => {
    const start = computeHeldPose({ timeMs: 0, ...REST, equipStartMs: 0 });
    expect(start.posY).toBeCloseTo(BASE_POSE.posY - 0.4);

    const done = computeHeldPose({ timeMs: EQUIP_MS, ...REST, equipStartMs: 0 });
    const idle = computeHeldPose({ timeMs: EQUIP_MS, ...REST });
    expect(done).toEqual(idle);
  });

  test("walk bob scales with moveFactor", () => {
    const timeMs = 130; // sin(timeMs * 0.012) well away from zero
    const still = computeHeldPose({ timeMs, ...REST });
    const walking = computeHeldPose({ timeMs, ...REST, moveFactor: 1 });
    expect(walking.posY).toBeLessThan(still.posY);
    expect(walking.posX).not.toBeCloseTo(still.posX, 5);

    const half = computeHeldPose({ timeMs, ...REST, moveFactor: 0.5 });
    expect(Math.abs(half.posX - still.posX)).toBeCloseTo(Math.abs(walking.posX - still.posX) / 2);
  });

  test("is deterministic for the same input", () => {
    const input = { timeMs: 1234, swingStartMs: 1100, continuousSwing: false, equipStartMs: 1000, moveFactor: 0.7 };
    expect(computeHeldPose(input)).toEqual(computeHeldPose(input));
  });
});
