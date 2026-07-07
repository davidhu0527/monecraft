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

describe("roofed (nether) column sampling", () => {
  test("skips the ceiling mass and reports the cavern floor beneath", () => {
    const world = new VoxelWorld(8, 20, 8, 1);
    // Column: bedrock cap, 3 of netherrack ceiling, open air, netherrack floor.
    world.set(4, 19, 4, BlockId.Bedrock);
    for (let y = 16; y <= 18; y += 1) world.set(4, y, 4, BlockId.Netherrack);
    world.set(4, 6, 4, BlockId.Netherrack);
    expect(topBlockAt(world, 4, 4, true)).toEqual({ block: BlockId.Netherrack, y: 6 });
    // The unroofed scan would have reported the bedrock cap.
    expect(topBlockAt(world, 4, 4)).toEqual({ block: BlockId.Bedrock, y: 19 });
  });
});
