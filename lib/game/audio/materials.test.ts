import { describe, expect, test } from "bun:test";
import { BlockId } from "@/lib/world";
import { MATERIAL_GROUPS, materialGroupFor } from "./materials";

describe("materialGroupFor", () => {
  test("every block id maps to a valid material group", () => {
    // BlockId is a const enum (no runtime object) — walk the contiguous range.
    for (let id = BlockId.Air; id <= BlockId.Cactus; id += 1) {
      expect(MATERIAL_GROUPS).toContain(materialGroupFor(id));
    }
  });

  test("representative blocks land in the expected groups", () => {
    expect(materialGroupFor(BlockId.Stone)).toBe("stone");
    expect(materialGroupFor(BlockId.DiamondOre)).toBe("stone");
    expect(materialGroupFor(BlockId.Planks)).toBe("wood");
    expect(materialGroupFor(BlockId.Leaves)).toBe("grass");
    expect(materialGroupFor(BlockId.Snow)).toBe("sand");
    expect(materialGroupFor(BlockId.Glass)).toBe("glass");
    expect(materialGroupFor(BlockId.Water)).toBe("water");
  });
});
