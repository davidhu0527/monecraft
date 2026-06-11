import { describe, expect, test } from "bun:test";
import { BlockId, VoxelWorld } from "@/lib/world";
import { columnColor, topBlockAt } from "@/lib/game/render/minimapColors";

function makeWorld(): VoxelWorld {
  return new VoxelWorld(8, 32, 8, 1);
}

describe("topBlockAt", () => {
  test("finds the topmost non-air block", () => {
    const world = makeWorld();
    world.set(2, 4, 2, BlockId.Stone);
    world.set(2, 9, 2, BlockId.Grass);
    expect(topBlockAt(world, 2, 2)).toEqual({ block: BlockId.Grass, y: 9 });
  });

  test("sees water columns, unlike highestSolidY", () => {
    const world = makeWorld();
    world.set(3, 2, 3, BlockId.Sand);
    world.set(3, 5, 3, BlockId.Water);
    expect(topBlockAt(world, 3, 3).block).toBe(BlockId.Water);
    expect(world.highestSolidY(3, 3)).toBe(2);
  });

  test("returns air for an empty column", () => {
    expect(topBlockAt(makeWorld(), 0, 0).block).toBe(BlockId.Air);
  });
});

describe("columnColor", () => {
  test("empty columns are black", () => {
    expect(columnColor(makeWorld(), 0, 0)).toEqual([0, 0, 0]);
  });

  test("higher terrain renders brighter than low terrain", () => {
    const world = makeWorld();
    world.set(1, 2, 1, BlockId.Stone);
    world.set(5, 28, 5, BlockId.Stone);
    const low = columnColor(world, 1, 1);
    const high = columnColor(world, 5, 5);
    expect(high[0]).toBeGreaterThan(low[0]);
    expect(high[1]).toBeGreaterThan(low[1]);
    expect(high[2]).toBeGreaterThan(low[2]);
  });

  test("different top blocks give different colors at the same height", () => {
    const world = makeWorld();
    world.set(1, 6, 1, BlockId.Grass);
    world.set(5, 6, 5, BlockId.Sand);
    expect(columnColor(world, 1, 1)).not.toEqual(columnColor(world, 5, 5));
  });
});
