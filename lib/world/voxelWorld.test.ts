import { describe, expect, test } from "bun:test";
import { BlockId, VoxelWorld } from "@/lib/world";

describe("VoxelWorld data structure", () => {
  test("starts empty (all air)", () => {
    const world = new VoxelWorld(8, 8, 8, 1);
    expect(world.blocks.every((b) => b === BlockId.Air)).toBe(true);
    expect(world.get(3, 3, 3)).toBe(BlockId.Air);
  });

  test("set and get round-trip", () => {
    const world = new VoxelWorld(8, 8, 8, 1);
    world.set(1, 2, 3, BlockId.Stone);
    expect(world.get(1, 2, 3)).toBe(BlockId.Stone);
    expect(world.get(3, 2, 1)).toBe(BlockId.Air);
  });

  test("out-of-bounds reads return air, writes are ignored", () => {
    const world = new VoxelWorld(8, 8, 8, 1);
    expect(world.get(-1, 0, 0)).toBe(BlockId.Air);
    expect(world.get(8, 0, 0)).toBe(BlockId.Air);
    world.set(-1, 0, 0, BlockId.Stone);
    world.set(0, 8, 0, BlockId.Stone);
    expect(world.blocks.every((b) => b === BlockId.Air)).toBe(true);
  });

  test("inBounds covers all axes", () => {
    const world = new VoxelWorld(4, 5, 6, 1);
    expect(world.inBounds(0, 0, 0)).toBe(true);
    expect(world.inBounds(3, 4, 5)).toBe(true);
    expect(world.inBounds(4, 0, 0)).toBe(false);
    expect(world.inBounds(0, 5, 0)).toBe(false);
    expect(world.inBounds(0, 0, 6)).toBe(false);
    expect(world.inBounds(-1, 0, 0)).toBe(false);
  });

  test("water and air are not solid, everything else is", () => {
    const world = new VoxelWorld(8, 8, 8, 1);
    world.set(0, 0, 0, BlockId.Water);
    world.set(1, 0, 0, BlockId.Glass);
    expect(world.isSolid(0, 0, 0)).toBe(false);
    expect(world.isSolid(2, 0, 0)).toBe(false);
    expect(world.isSolid(1, 0, 0)).toBe(true);
  });

  test("highestSolidY skips water and finds the top solid block", () => {
    const world = new VoxelWorld(8, 8, 8, 1);
    world.set(2, 1, 2, BlockId.Stone);
    world.set(2, 3, 2, BlockId.Dirt);
    world.set(2, 5, 2, BlockId.Water);
    expect(world.highestSolidY(2, 2)).toBe(3);
    expect(world.highestSolidY(0, 0)).toBe(0);
  });

  test("voxel index formula is x + z*sizeX + y*sizeX*sizeZ (save-format invariant)", () => {
    // Saved block-change deltas address voxels by this exact formula.
    // Changing it silently corrupts every existing save.
    const world = new VoxelWorld(16, 8, 16, 1);
    expect(world.index(0, 0, 0)).toBe(0);
    expect(world.index(5, 0, 0)).toBe(5);
    expect(world.index(0, 0, 5)).toBe(5 * 16);
    expect(world.index(0, 5, 0)).toBe(5 * 16 * 16);
    expect(world.index(3, 2, 1)).toBe(3 + 1 * 16 + 2 * 16 * 16);
  });
});
