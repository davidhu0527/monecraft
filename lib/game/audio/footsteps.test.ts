import { describe, expect, test } from "bun:test";
import { createFootstepScheduler, STEP_DISTANCE } from "./footsteps";

describe("footstep scheduler", () => {
  test("emits one step per stride distance walked", () => {
    const scheduler = createFootstepScheduler();
    let steps = 0;
    // 10 blocks in 0.1-block ticks → floor(10 / STEP_DISTANCE) steps.
    for (let i = 0; i < 100; i += 1) if (scheduler.tick(true, 0.1, 0)) steps += 1;
    expect(steps).toBe(Math.floor(10 / STEP_DISTANCE));
  });

  test("standing still never steps", () => {
    const scheduler = createFootstepScheduler();
    for (let i = 0; i < 200; i += 1) expect(scheduler.tick(true, 0, 0)).toBe(false);
  });

  test("going airborne resets the stride", () => {
    const scheduler = createFootstepScheduler();
    // Walk almost a full stride, jump, then land and walk the same again —
    // the pre-jump distance must not carry over.
    for (let i = 0; i < 9; i += 1) expect(scheduler.tick(true, 0.2, 0)).toBe(false);
    scheduler.tick(false, 0.2, 0);
    for (let i = 0; i < 9; i += 1) expect(scheduler.tick(true, 0.2, 0)).toBe(false);
  });

  test("overshoot beyond the stride carries into the next one", () => {
    const scheduler = createFootstepScheduler();
    // 1.5-block ticks against a 2-block stride: cumulative 3.0 / 2.5 / 2.0
    // each cross the threshold once the remainder carries over.
    let steps = 0;
    for (let i = 0; i < 4; i += 1) if (scheduler.tick(true, 1.5, 0)) steps += 1;
    expect(steps).toBe(3);
  });

  test("diagonal movement counts full horizontal distance", () => {
    const scheduler = createFootstepScheduler();
    const d = STEP_DISTANCE / Math.SQRT2 / 4 + 0.001;
    let steps = 0;
    for (let i = 0; i < 4; i += 1) if (scheduler.tick(true, d, d)) steps += 1;
    expect(steps).toBe(1);
  });
});
