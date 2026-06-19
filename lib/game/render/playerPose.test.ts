import { describe, expect, test } from "bun:test";
import { computePlayerPose, PLAYER_CAST_MS, PLAYER_REEL_MS, PLAYER_SWING_MS } from "@/lib/game/render/playerPose";

const idle = { moveFactor: 0, miningActive: false, swingStartMs: -Infinity };

describe("computePlayerPose", () => {
  test("idle body holds every limb at rest", () => {
    const pose = computePlayerPose({ timeMs: 1234, ...idle });
    expect(pose.leftArmX).toBeCloseTo(0);
    expect(pose.rightArmX).toBeCloseTo(0);
    expect(pose.leftLegX).toBeCloseTo(0);
    expect(pose.rightLegX).toBeCloseTo(0);
  });

  test("walking counter-phases the legs and opposes each arm to its leg", () => {
    // sin(t*0.012) peaks near t = pi/2 / 0.012.
    const timeMs = Math.PI / 2 / 0.012;
    const pose = computePlayerPose({ timeMs, ...idle, moveFactor: 1 });
    expect(pose.leftLegX).toBeGreaterThan(0.5);
    expect(pose.rightLegX).toBeCloseTo(-pose.leftLegX);
    expect(Math.sign(pose.leftArmX)).toBe(-Math.sign(pose.leftLegX));
    expect(Math.sign(pose.rightArmX)).toBe(-Math.sign(pose.rightLegX));
  });

  test("gait scales with moveFactor", () => {
    const timeMs = Math.PI / 2 / 0.012;
    const slow = computePlayerPose({ timeMs, ...idle, moveFactor: 0.5 });
    const fast = computePlayerPose({ timeMs, ...idle, moveFactor: 1 });
    expect(slow.leftLegX).toBeCloseTo(fast.leftLegX / 2);
  });

  test("a swing raises the right arm forward, then returns to rest", () => {
    const mid = computePlayerPose({ timeMs: PLAYER_SWING_MS / 2, ...idle, swingStartMs: 0 });
    expect(mid.rightArmX).toBeLessThan(-1);
    const done = computePlayerPose({ timeMs: PLAYER_SWING_MS * 2, ...idle, swingStartMs: 0 });
    expect(done.rightArmX).toBeCloseTo(0);
  });

  test("mining loops the chop past the one-shot window", () => {
    const looped = computePlayerPose({ timeMs: PLAYER_SWING_MS * 2.5, ...idle, miningActive: true, swingStartMs: 0 });
    expect(looped.rightArmX).toBeLessThan(-1);
  });

  test("fishing extends the rod arm forward and returns to rest after a cast/reel", () => {
    const stance = computePlayerPose({ timeMs: 1234, ...idle, fishingActive: true });
    expect(stance.rightArmX).toBeLessThan(-1); // held out over the water

    const flick = computePlayerPose({ timeMs: PLAYER_CAST_MS * 0.7, ...idle, fishingActive: true, castStartMs: 0 });
    expect(flick.rightArmX).toBeLessThan(stance.rightArmX); // flicks further forward

    const reel = computePlayerPose({ timeMs: PLAYER_REEL_MS / 2, ...idle, fishingActive: true, reelStartMs: 0 });
    expect(reel.rightArmX).toBeGreaterThan(stance.rightArmX); // yanks back up

    // Both one-shots over → only the stance remains.
    const after = computePlayerPose({ timeMs: PLAYER_CAST_MS * 2, ...idle, fishingActive: true, castStartMs: 0, reelStartMs: 0 });
    expect(after.rightArmX).toBeCloseTo(stance.rightArmX);
  });

  test("the fishing arm layers stay off when not fishing", () => {
    expect(computePlayerPose({ timeMs: 1234, ...idle })).toEqual(computePlayerPose({ timeMs: 1234, ...idle, fishingActive: false }));
  });
});
