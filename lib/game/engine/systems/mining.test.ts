import { describe, expect, test } from "bun:test";
import { BlockId } from "@/lib/world";
import { canMineBlock } from "@/lib/game/engine/systems/mining";

describe("canMineBlock tool tiers", () => {
  test("coal ore needs a wood pickaxe (tier 1), like stone", () => {
    expect(canMineBlock(BlockId.CoalOre, 0)).toBe(false); // bare hand can't
    expect(canMineBlock(BlockId.CoalOre, 1)).toBe(true); // wood pickaxe can
    expect(canMineBlock(BlockId.Stone, 0)).toBe(false);
    expect(canMineBlock(BlockId.Stone, 1)).toBe(true);
  });

  test("rarer ores keep their higher tier gates", () => {
    expect(canMineBlock(BlockId.SliverOre, 1)).toBe(false);
    expect(canMineBlock(BlockId.SliverOre, 2)).toBe(true);
    expect(canMineBlock(BlockId.DiamondOre, 3)).toBe(false);
    expect(canMineBlock(BlockId.DiamondOre, 4)).toBe(true);
  });

  test("soft blocks break with bare hands", () => {
    expect(canMineBlock(BlockId.Dirt, 0)).toBe(true);
    expect(canMineBlock(BlockId.Grass, 0)).toBe(true);
    expect(canMineBlock(BlockId.Wood, 0)).toBe(true);
  });
});
