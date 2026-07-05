import { describe, expect, test } from "bun:test";
import { BlockId, VoxelWorld } from "@/lib/world";
import { createBlockChangeTracker } from "./blockChanges";

describe("edit journal", () => {
  test("drainEdits returns [idx, block] pairs and clears the window", () => {
    const world = new VoxelWorld(8, 8, 8);
    const tracker = createBlockChangeTracker(world);
    tracker.set(1, 2, 3, BlockId.Dirt);
    const idx = world.index(1, 2, 3);
    expect(tracker.drainEdits()).toEqual([[idx, BlockId.Dirt]]);
    expect(tracker.drainEdits()).toEqual([]);
    expect(world.get(1, 2, 3)).toBe(BlockId.Dirt);
  });

  test("drainEditsDetailed carries the pre-window value, coalescing same-cell rewrites", () => {
    const world = new VoxelWorld(8, 8, 8);
    const tracker = createBlockChangeTracker(world);
    world.set(1, 2, 3, BlockId.Stone);
    tracker.set(1, 2, 3, BlockId.Dirt);
    tracker.set(1, 2, 3, BlockId.Sand); // same window: last block wins, FIRST prev survives
    const idx = world.index(1, 2, 3);
    expect(tracker.drainEditsDetailed()).toEqual([{ idx, block: BlockId.Sand, prev: BlockId.Stone }]);
    // A fresh window starts from the world's current value.
    tracker.set(1, 2, 3, BlockId.Air);
    expect(tracker.drainEditsDetailed()).toEqual([{ idx, block: BlockId.Air, prev: BlockId.Sand }]);
  });

  test("the two drains share one window", () => {
    const world = new VoxelWorld(8, 8, 8);
    const tracker = createBlockChangeTracker(world);
    tracker.set(0, 1, 0, BlockId.Dirt);
    expect(tracker.drainEditsDetailed()).toHaveLength(1);
    expect(tracker.drainEdits()).toEqual([]);
  });
});
