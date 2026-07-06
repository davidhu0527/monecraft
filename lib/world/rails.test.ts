import { describe, expect, test } from "bun:test";
import {
  BlockId,
  isDetectorRail,
  isPoweredRail,
  isRailBlock,
  isRedstoneBlock,
  isRedstoneOn,
  isRedstoneOverlay,
  railAxis,
  railBounds,
  redstoneOff,
  redstoneOn,
  VoxelWorld
} from "@/lib/world";

const ALL_RAILS: BlockId[] = [BlockId.PoweredRail, BlockId.PoweredRailOn, BlockId.DetectorRail, BlockId.DetectorRailOn, BlockId.Rail];

describe("rail block ids", () => {
  test("family and member predicates", () => {
    for (const block of ALL_RAILS) expect(isRailBlock(block)).toBe(true);
    expect(isRailBlock(BlockId.RedstoneLampOn)).toBe(false);
    expect(isRailBlock(BlockId.Stone)).toBe(false);
    expect(isPoweredRail(BlockId.PoweredRail)).toBe(true);
    expect(isPoweredRail(BlockId.PoweredRailOn)).toBe(true);
    expect(isPoweredRail(BlockId.Rail)).toBe(false);
    expect(isDetectorRail(BlockId.DetectorRail)).toBe(true);
    expect(isDetectorRail(BlockId.DetectorRailOn)).toBe(true);
    expect(isDetectorRail(BlockId.PoweredRail)).toBe(false);
  });

  test("powered/detector pairs join the redstone family; plain rail does not", () => {
    expect(isRedstoneBlock(BlockId.PoweredRail)).toBe(true);
    expect(isRedstoneBlock(BlockId.PoweredRailOn)).toBe(true);
    expect(isRedstoneBlock(BlockId.DetectorRail)).toBe(true);
    expect(isRedstoneBlock(BlockId.DetectorRailOn)).toBe(true);
    expect(isRedstoneBlock(BlockId.Rail)).toBe(false);
    // Rails are not overlays in the 58..67 sense — they have their own predicate.
    for (const block of ALL_RAILS) expect(isRedstoneOverlay(block)).toBe(false);
  });

  test("powered/detector power state is id parity and round-trips", () => {
    for (const pair of [BlockId.PoweredRail, BlockId.DetectorRail]) {
      const on = redstoneOn(pair);
      expect(isRedstoneOn(on)).toBe(true);
      expect(isRedstoneOn(pair)).toBe(false);
      expect(redstoneOff(on)).toBe(pair);
    }
    expect(redstoneOn(BlockId.PoweredRail)).toBe(BlockId.PoweredRailOn);
    expect(redstoneOn(BlockId.DetectorRail)).toBe(BlockId.DetectorRailOn);
    // Plain Rail carries no power state and never reads as powered.
    expect(isRedstoneOn(BlockId.Rail)).toBe(false);
  });

  test("rail bounds are a flat floor overlay inside the unit cell", () => {
    const bounds = railBounds();
    expect(bounds.minY).toBe(0);
    expect(bounds.maxY).toBeLessThan(0.2);
    expect(bounds.minX).toBeGreaterThanOrEqual(0);
    expect(bounds.maxX).toBeLessThanOrEqual(1);
    expect(bounds.minZ).toBeGreaterThanOrEqual(0);
    expect(bounds.maxZ).toBeLessThanOrEqual(1);
  });
});

describe("railAxis", () => {
  const world = new VoxelWorld(16, 16, 16);

  test("derives the track axis from rail neighbors", () => {
    world.set(4, 5, 4, BlockId.Rail);
    world.set(5, 5, 4, BlockId.Rail);
    world.set(6, 5, 4, BlockId.Rail);
    expect(railAxis(world, 5, 5, 4)).toBe("x");

    world.set(10, 5, 4, BlockId.Rail);
    world.set(10, 5, 5, BlockId.Rail);
    world.set(10, 5, 6, BlockId.Rail);
    expect(railAxis(world, 10, 5, 5)).toBe("z");
  });

  test("an isolated rail defaults to x; a corner reads as x", () => {
    world.set(2, 8, 2, BlockId.Rail);
    expect(railAxis(world, 2, 8, 2)).toBe("x");

    // L corner: rails to the east and the south — the dominant-axis rule picks x.
    world.set(12, 5, 12, BlockId.Rail);
    world.set(13, 5, 12, BlockId.Rail);
    world.set(12, 5, 13, BlockId.Rail);
    expect(railAxis(world, 12, 5, 12)).toBe("x");
  });
});
