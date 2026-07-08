import { describe, expect, test } from "bun:test";
import { BlockId, isPartialBlock, isSlabBlock, isStairBlock, shapeBoxes, stairBlock, stairFacing, type StairFacing } from "@/lib/world";

const ALL_SLABS: BlockId[] = [BlockId.PlankSlab, BlockId.StoneSlab, BlockId.CobbleSlab];
const ALL_STAIRS: BlockId[] = [
  BlockId.PlankStairsNorth,
  BlockId.PlankStairsEast,
  BlockId.PlankStairsSouth,
  BlockId.PlankStairsWest,
  BlockId.StoneStairsNorth,
  BlockId.StoneStairsEast,
  BlockId.StoneStairsSouth,
  BlockId.StoneStairsWest,
  BlockId.CobbleStairsNorth,
  BlockId.CobbleStairsEast,
  BlockId.CobbleStairsSouth,
  BlockId.CobbleStairsWest
];
const FACINGS: readonly StairFacing[] = ["north", "east", "south", "west"];

describe("slab and stair block ids", () => {
  test("family predicates", () => {
    for (const block of ALL_SLABS) {
      expect(isSlabBlock(block)).toBe(true);
      expect(isStairBlock(block)).toBe(false);
      expect(isPartialBlock(block)).toBe(true);
    }
    for (const block of ALL_STAIRS) {
      expect(isStairBlock(block)).toBe(true);
      expect(isSlabBlock(block)).toBe(false);
      expect(isPartialBlock(block)).toBe(true);
    }
    expect(isPartialBlock(BlockId.Rail)).toBe(false);
    expect(isPartialBlock(BlockId.Stone)).toBe(false);
  });

  test("stair id ↔ facing round-trips for every material", () => {
    for (const material of ["plank", "stone", "cobble"] as const) {
      for (const facing of FACINGS) {
        const block = stairBlock(material, facing);
        expect(isStairBlock(block)).toBe(true);
        expect(stairFacing(block)).toBe(facing);
      }
    }
    expect(stairFacing(BlockId.PlankSlab)).toBeNull();
    expect(stairFacing(BlockId.Stone)).toBeNull();
  });
});

describe("shapeBoxes", () => {
  test("a slab is one bottom-half box", () => {
    for (const block of ALL_SLABS) {
      const boxes = shapeBoxes(block)!;
      expect(boxes).toHaveLength(1);
      expect(boxes[0]).toEqual({ minX: 0, maxX: 1, minY: 0, maxY: 0.5, minZ: 0, maxZ: 1 });
    }
  });

  test("a stair is the slab plus a raised back on the side it faces", () => {
    for (const block of ALL_STAIRS) {
      const boxes = shapeBoxes(block)!;
      expect(boxes).toHaveLength(2);
      expect(boxes[0].maxY).toBe(0.5); // bottom half
      const top = boxes[1];
      expect(top.minY).toBe(0.5);
      expect(top.maxY).toBe(1);
      // The raised back occupies exactly half the footprint.
      const area = (top.maxX - top.minX) * (top.maxZ - top.minZ);
      expect(area).toBeCloseTo(0.5, 10);
    }
    // Facing picks the correct half: north = -z, east = +x.
    expect(shapeBoxes(stairBlock("stone", "north"))![1].maxZ).toBe(0.5);
    expect(shapeBoxes(stairBlock("stone", "south"))![1].minZ).toBe(0.5);
    expect(shapeBoxes(stairBlock("stone", "east"))![1].minX).toBe(0.5);
    expect(shapeBoxes(stairBlock("stone", "west"))![1].maxX).toBe(0.5);
  });

  test("non-partial blocks yield null; box arrays are cached (no per-call allocation)", () => {
    expect(shapeBoxes(BlockId.Stone)).toBeNull();
    expect(shapeBoxes(BlockId.Rail)).toBeNull();
    expect(shapeBoxes(BlockId.PlankSlab)).toBe(shapeBoxes(BlockId.StoneSlab)!); // slabs share the one frozen array
    expect(shapeBoxes(BlockId.PlankStairsNorth)).toBe(shapeBoxes(BlockId.StoneStairsNorth)!);
  });
});
