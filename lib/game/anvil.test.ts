import { describe, expect, test } from "bun:test";
import { ANVIL_MATERIAL_REPAIR_PCT, ANVIL_REPAIR_BONUS_PCT, CUSTOM_NAME_MAX_LEN, ENCHANT_MAX_LEVEL, MENDING_MAX_LEVEL } from "@/lib/game/config";
import {
  canMaterialRepair,
  combineSlots,
  findSacrificeIndex,
  isAnvilGear,
  materialRepair,
  mergeEnchantments,
  repairMaterialFor,
  sanitizeCustomName,
  wouldCombineHelp
} from "@/lib/game/anvil";
import { createEmptySlot, createSlot } from "@/lib/game/items";
import type { Enchantment, EnchantmentId, InventorySlot } from "@/lib/game/types";

const ench = (id: EnchantmentId, level: number): Enchantment => ({ id, level });
const withEnchants = (slot: InventorySlot, ...e: Enchantment[]): InventorySlot => ({ ...slot, enchantments: e });
const damaged = (id: string, durability: number): InventorySlot => ({ ...createSlot(id, 1), durability });

describe("isAnvilGear", () => {
  test("true for durable gear, false for blocks/materials/empty", () => {
    expect(isAnvilGear(createSlot("diamond_sword", 1))).toBe(true);
    expect(isAnvilGear(createSlot("diamond_pickaxe", 1))).toBe(true);
    expect(isAnvilGear(createSlot("helmet", 1))).toBe(true);
    expect(isAnvilGear(createSlot("dirt", 1))).toBe(false);
    expect(isAnvilGear(createSlot("string", 1))).toBe(false);
    expect(isAnvilGear(createEmptySlot())).toBe(false);
  });
});

describe("mergeEnchantments", () => {
  test("takes the higher level per id and caps each at its def maxLevel", () => {
    const merged = mergeEnchantments([ench("sharpness", 1), ench("unbreaking", 1)], [ench("sharpness", 3)]);
    expect(merged).toContainEqual(ench("sharpness", ENCHANT_MAX_LEVEL));
    expect(merged).toContainEqual(ench("unbreaking", 1));
    // Mending is binary — two level-1 stay level 1.
    expect(mergeEnchantments([ench("mending", 1)], [ench("mending", 1)])).toEqual([ench("mending", MENDING_MAX_LEVEL)]);
  });

  test("over-cap input is clamped", () => {
    expect(mergeEnchantments([ench("sharpness", 9)], [])).toEqual([ench("sharpness", ENCHANT_MAX_LEVEL)]);
  });
});

describe("findSacrificeIndex", () => {
  test("finds another slot with the same durable id, excluding the target itself", () => {
    const slots = [createSlot("diamond_sword", 1), createSlot("dirt", 5), createSlot("diamond_sword", 1)];
    expect(findSacrificeIndex(slots, 0)).toBe(2);
  });

  test("returns -1 when there is no duplicate or the target isn't gear", () => {
    expect(findSacrificeIndex([createSlot("diamond_sword", 1), createSlot("ruby_sword", 1)], 0)).toBe(-1);
    expect(findSacrificeIndex([createSlot("dirt", 1), createSlot("dirt", 1)], 0)).toBe(-1);
  });
});

describe("wouldCombineHelp", () => {
  test("true when the target is damaged", () => {
    expect(wouldCombineHelp(damaged("diamond_sword", 100), createSlot("diamond_sword", 1))).toBe(true);
  });

  test("true when the sacrifice adds or raises an enchant", () => {
    const target = createSlot("diamond_sword", 1); // full
    const sacrifice = withEnchants(createSlot("diamond_sword", 1), ench("sharpness", 2));
    expect(wouldCombineHelp(target, sacrifice)).toBe(true);
  });

  test("false when full and no new enchantment would be gained", () => {
    const target = withEnchants(createSlot("diamond_sword", 1), ench("sharpness", 3));
    const sacrifice = withEnchants(createSlot("diamond_sword", 1), ench("sharpness", 1));
    expect(wouldCombineHelp(target, sacrifice)).toBe(false);
  });
});

describe("combineSlots", () => {
  test("sums durability with a bonus, capped at max, and merges enchantments immutably", () => {
    const target = withEnchants(damaged("diamond_sword", 300), ench("sharpness", 2));
    const sacrifice = withEnchants(damaged("diamond_sword", 200), ench("unbreaking", 1));
    const out = combineSlots(target, sacrifice);
    const max = target.maxDurability!;
    expect(out.durability).toBe(Math.min(max, 300 + 200 + Math.floor(max * ANVIL_REPAIR_BONUS_PCT)));
    expect(out.enchantments).toContainEqual(ench("sharpness", 2));
    expect(out.enchantments).toContainEqual(ench("unbreaking", 1));
    expect(target.durability).toBe(300); // original untouched
  });

  test("clears enchantments to undefined when neither item has any", () => {
    const out = combineSlots(damaged("diamond_pickaxe", 100), damaged("diamond_pickaxe", 100));
    expect(out.enchantments).toBeUndefined();
  });
});

describe("material repair", () => {
  test("repairMaterialFor maps gear to its tier material", () => {
    expect(repairMaterialFor(createSlot("diamond_sword", 1))).toBe("diamond_ore");
    expect(repairMaterialFor(createSlot("stone_pickaxe", 1))).toBe("cobble");
    expect(repairMaterialFor(createSlot("dirt", 1))).toBeUndefined();
  });

  test("canMaterialRepair requires damaged gear, a known material, and a unit in stock", () => {
    const dmg = damaged("diamond_sword", 100);
    expect(canMaterialRepair(dmg, [dmg, createSlot("diamond_ore", 3)])).toBe(true);
    expect(canMaterialRepair(dmg, [dmg])).toBe(false); // no material
    expect(canMaterialRepair(createSlot("diamond_sword", 1), [createSlot("diamond_ore", 3)])).toBe(false); // full
  });

  test("materialRepair restores a fixed fraction of max, capped", () => {
    const dmg = damaged("diamond_sword", 100);
    const max = dmg.maxDurability!;
    expect(materialRepair(dmg).durability).toBe(Math.min(max, 100 + Math.ceil(max * ANVIL_MATERIAL_REPAIR_PCT)));
    expect(materialRepair(damaged("diamond_sword", max - 1)).durability).toBe(max); // can't exceed max
  });
});

describe("sanitizeCustomName", () => {
  test("trims, caps to the max length, and yields empty for blanks", () => {
    expect(sanitizeCustomName("  Sting  ")).toBe("Sting");
    expect(sanitizeCustomName("   ")).toBe("");
    expect(sanitizeCustomName("x".repeat(80))).toBe("x".repeat(CUSTOM_NAME_MAX_LEN));
  });
});
