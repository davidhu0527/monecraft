import { describe, expect, test } from "bun:test";
import { createMobPoseHistory, MELEE_REWIND_MAX_TICKS, MOB_HISTORY_DEPTH } from "./mobHistory";

const mob = (id: number, x: number, y = 64, z = 0) => ({ id, position: { x, y, z } });

describe("createMobPoseHistory", () => {
  test("records a tick and returns each mob's position at it", () => {
    const history = createMobPoseHistory();
    history.record(10, [mob(1, 1.5), mob(2, -3, 60, 4)]);
    expect(history.positionAt(10, 1)).toEqual({ x: 1.5, y: 64, z: 0 });
    expect(history.positionAt(10, 2)).toEqual({ x: -3, y: 60, z: 4 });
  });

  test("unknown mob ids and never-recorded ticks are null", () => {
    const history = createMobPoseHistory();
    history.record(10, [mob(1, 1)]);
    expect(history.positionAt(10, 999)).toBeNull(); // mob didn't exist then
    expect(history.positionAt(9, 1)).toBeNull(); // tick never recorded
  });

  test("the ring evicts ticks older than its depth", () => {
    const history = createMobPoseHistory(4);
    for (let tick = 0; tick < 8; tick += 1) history.record(tick, [mob(1, tick)]);
    expect(history.positionAt(3, 1)).toBeNull(); // evicted (slot reused by tick 7)
    expect(history.positionAt(4, 1)).toEqual({ x: 4, y: 64, z: 0 });
    expect(history.positionAt(7, 1)).toEqual({ x: 7, y: 64, z: 0 });
  });

  test("re-recording a slot replaces it cleanly, including a shrunk mob list", () => {
    const history = createMobPoseHistory(4);
    history.record(1, [mob(1, 1), mob(2, 2), mob(3, 3)]);
    history.record(5, [mob(1, 50)]); // same slot (5 % 4 === 1), fewer mobs
    expect(history.positionAt(5, 1)).toEqual({ x: 50, y: 64, z: 0 });
    expect(history.positionAt(5, 2)).toBeNull(); // stale trailing entry must not leak
    expect(history.positionAt(1, 1)).toBeNull(); // the old tick is gone
  });

  test("the default depth covers the whole rewind clamp window", () => {
    expect(MOB_HISTORY_DEPTH).toBeGreaterThan(MELEE_REWIND_MAX_TICKS);
    const history = createMobPoseHistory();
    const now = 1000;
    for (let tick = now - MELEE_REWIND_MAX_TICKS; tick <= now; tick += 1) history.record(tick, [mob(7, tick)]);
    // The oldest tick the room clamp can ever ask for is still resolvable.
    expect(history.positionAt(now - MELEE_REWIND_MAX_TICKS, 7)).toEqual({ x: now - MELEE_REWIND_MAX_TICKS, y: 64, z: 0 });
  });
});
