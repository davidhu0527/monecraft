import { describe, expect, test } from "bun:test";
import { GRINDSTONE_REFUND_XP_PER_LEVEL } from "@/lib/game/config";
import { canStripEnchantments, enchantRefund, stripEnchantments, totalEnchantLevels } from "@/lib/game/grindstone";
import { createSlot } from "@/lib/game/items";
import type { Enchantment, InventorySlot } from "@/lib/game/types";

const withEnchants = (id: string, ...e: Enchantment[]): InventorySlot => ({ ...createSlot(id, 1), enchantments: e });
const ench = (id: string, level: number): Enchantment => ({ id: id as never, level });

describe("grindstone", () => {
  test("totalEnchantLevels sums every enchantment's level", () => {
    expect(totalEnchantLevels(createSlot("diamond_sword", 1))).toBe(0);
    expect(totalEnchantLevels(withEnchants("diamond_sword", ench("sharpness", 3), ench("unbreaking", 1)))).toBe(4);
  });

  test("canStripEnchantments is true only when enchantments are present", () => {
    expect(canStripEnchantments(withEnchants("diamond_sword", ench("sharpness", 1)))).toBe(true);
    expect(canStripEnchantments(createSlot("diamond_sword", 1))).toBe(false);
    expect(canStripEnchantments(createSlot("dirt", 1))).toBe(false);
  });

  test("enchantRefund scales with total levels", () => {
    expect(enchantRefund(withEnchants("diamond_sword", ench("sharpness", 3), ench("unbreaking", 1)))).toBe(4 * GRINDSTONE_REFUND_XP_PER_LEVEL);
  });

  test("stripEnchantments clears enchantments immutably", () => {
    const before = withEnchants("diamond_sword", ench("sharpness", 2));
    const after = stripEnchantments(before);
    expect(after.enchantments).toBeUndefined();
    expect(before.enchantments).toHaveLength(1); // original untouched
  });
});
