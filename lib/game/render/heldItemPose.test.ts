import { describe, expect, test } from "bun:test";
import { BASE_POSE, CAST_MS, computeHeldPose, EQUIP_MS, REEL_MS, SWING_MS } from "@/lib/game/render/heldItemPose";

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

  test("the fishing stance holds the rod up and forward over the water", () => {
    const idle = computeHeldPose({ timeMs: 0, ...REST });
    const fishing = computeHeldPose({ timeMs: 0, ...REST, fishingActive: true });
    expect(fishing.posY).toBeGreaterThan(idle.posY); // raised
    expect(fishing.posZ).toBeLessThan(idle.posZ); // pushed forward
    expect(fishing.rotX).toBeGreaterThan(idle.rotX); // tip tilted up
  });

  test("a cast winds the tip back then flicks it forward", () => {
    const base = computeHeldPose({ timeMs: 0, ...REST, fishingActive: true });
    const windUp = computeHeldPose({ timeMs: CAST_MS * 0.2, ...REST, fishingActive: true, castStartMs: 0 });
    const flick = computeHeldPose({ timeMs: CAST_MS * 0.7, ...REST, fishingActive: true, castStartMs: 0 });
    expect(windUp.rotX).toBeGreaterThan(base.rotX); // tip back during the wind-up
    expect(flick.rotX).toBeLessThan(base.rotX); // snaps forward on the flick
    // After the cast completes only the stance remains.
    const after = computeHeldPose({ timeMs: CAST_MS * 1.5, ...REST, fishingActive: true, castStartMs: 0 });
    expect(after).toEqual(computeHeldPose({ timeMs: CAST_MS * 1.5, ...REST, fishingActive: true }));
  });

  test("a reel yanks the rod up and back, then settles", () => {
    const base = computeHeldPose({ timeMs: 0, ...REST, fishingActive: true });
    const mid = computeHeldPose({ timeMs: REEL_MS / 2, ...REST, fishingActive: true, reelStartMs: 0 });
    expect(mid.rotX).toBeGreaterThan(base.rotX);
    expect(mid.posY).toBeGreaterThan(base.posY);
    const after = computeHeldPose({ timeMs: REEL_MS * 1.5, ...REST, fishingActive: true, reelStartMs: 0 });
    expect(after).toEqual(computeHeldPose({ timeMs: REEL_MS * 1.5, ...REST, fishingActive: true }));
  });

  test("a bite adds a tip twitch", () => {
    const timeMs = 100;
    const calm = computeHeldPose({ timeMs, ...REST, fishingActive: true });
    const biting = computeHeldPose({ timeMs, ...REST, fishingActive: true, fishingBiting: true });
    expect(biting.rotX).not.toBeCloseTo(calm.rotX, 5);
  });
});
