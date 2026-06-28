import { describe, expect, test } from "bun:test";
import {
  EFFICIENCY_SPEED_PER_LEVEL,
  ENCHANT_MAX_LEVEL,
  KNOCKBACK_PER_LEVEL,
  MENDING_REPAIR_PER_XP,
  POWER_DAMAGE_PER_LEVEL,
  PUNCH_KNOCKBACK_PER_LEVEL,
  SHARPNESS_DAMAGE_PER_LEVEL
} from "@/lib/game/config";
import { createEmptyArmorEquipment, createSlot } from "@/lib/game/items";
import { armorReduction, consumeToolDurability, equippedDefense } from "@/lib/game/inventory";
import { miningSpeed } from "@/lib/game/engine/systems/mining";
import {
  applyEnchant,
  canEnchant,
  efficiencyMultiplier,
  enchantLevel,
  knockbackBonus,
  lootingLevel,
  mendXp,
  powerBonus,
  punchKnockback,
  sharpnessBonus,
  unbreakingSkips
} from "@/lib/game/enchantments";
import type { EquippedArmor, InventorySlot } from "@/lib/game/types";

const withEnchant = (id: string, level: number, slot: InventorySlot): InventorySlot => ({ ...slot, enchantments: [{ id: id as never, level }] });

describe("canEnchant / applyEnchant", () => {
  test("gates by item kind", () => {
    expect(canEnchant(createSlot("diamond_sword", 1), "sharpness")).toBe(true);
    expect(canEnchant(createSlot("diamond_pickaxe", 1), "sharpness")).toBe(false); // tool, not weapon
    expect(canEnchant(createSlot("diamond_pickaxe", 1), "efficiency")).toBe(true);
    expect(canEnchant(createSlot("helmet", 1), "protection")).toBe(true);
    expect(canEnchant(createSlot("helmet", 1), "efficiency")).toBe(false);
    // Unbreaking and Mending apply to all three durable kinds.
    expect(canEnchant(createSlot("diamond_sword", 1), "unbreaking")).toBe(true);
    expect(canEnchant(createSlot("diamond_pickaxe", 1), "unbreaking")).toBe(true);
    expect(canEnchant(createSlot("helmet", 1), "unbreaking")).toBe(true);
    expect(canEnchant(createSlot("diamond_sword", 1), "mending")).toBe(true);
    expect(canEnchant(createSlot("diamond_pickaxe", 1), "mending")).toBe(true);
    expect(canEnchant(createSlot("helmet", 1), "mending")).toBe(true);
    // Non-durable / empty slots can't be enchanted.
    expect(canEnchant(createSlot("dirt", 1), "unbreaking")).toBe(false);
  });

  test("Power and Punch are bow-only (the itemIds allow-list), not for other weapons", () => {
    expect(canEnchant(createSlot("bow", 1), "power")).toBe(true);
    expect(canEnchant(createSlot("bow", 1), "punch")).toBe(true);
    // Swords are `weapon` too, but the itemIds gate keeps these bow-specific enchants off them.
    expect(canEnchant(createSlot("diamond_sword", 1), "power")).toBe(false);
    expect(canEnchant(createSlot("diamond_sword", 1), "punch")).toBe(false);
    // The bow still can't take a melee enchant it doesn't qualify for via kind (e.g. Protection).
    expect(canEnchant(createSlot("bow", 1), "protection")).toBe(false);
  });

  test("Knockback and Looting apply to weapons but not tools or armor", () => {
    expect(canEnchant(createSlot("diamond_sword", 1), "knockback")).toBe(true);
    expect(canEnchant(createSlot("diamond_sword", 1), "looting")).toBe(true);
    expect(canEnchant(createSlot("diamond_pickaxe", 1), "knockback")).toBe(false);
    expect(canEnchant(createSlot("diamond_pickaxe", 1), "looting")).toBe(false);
    expect(canEnchant(createSlot("helmet", 1), "looting")).toBe(false);
  });

  test("applyEnchant adds then levels up, immutably, and stops at the cap", () => {
    const sword = createSlot("diamond_sword", 1);
    const once = applyEnchant(sword, "sharpness");
    expect(enchantLevel(once, "sharpness")).toBe(1);
    expect(sword.enchantments).toBeUndefined(); // original untouched

    const twice = applyEnchant(once, "sharpness");
    expect(enchantLevel(twice, "sharpness")).toBe(2);

    let maxed = sword;
    for (let i = 0; i < ENCHANT_MAX_LEVEL + 2; i += 1) maxed = applyEnchant(maxed, "sharpness");
    expect(enchantLevel(maxed, "sharpness")).toBe(ENCHANT_MAX_LEVEL);
    expect(canEnchant(maxed, "sharpness")).toBe(false);
  });
});

describe("seam readers", () => {
  test("Sharpness adds flat melee damage per level", () => {
    expect(sharpnessBonus(createSlot("diamond_sword", 1))).toBe(0);
    expect(sharpnessBonus(withEnchant("sharpness", 2, createSlot("diamond_sword", 1)))).toBe(2 * SHARPNESS_DAMAGE_PER_LEVEL);
  });

  test("Power and Punch add flat bow bonuses per level (0 when absent)", () => {
    const bow = createSlot("bow", 1);
    expect(powerBonus(bow)).toBe(0);
    expect(punchKnockback(bow)).toBe(0);
    expect(powerBonus(withEnchant("power", 3, bow))).toBe(3 * POWER_DAMAGE_PER_LEVEL);
    expect(punchKnockback(withEnchant("punch", 2, bow))).toBe(2 * PUNCH_KNOCKBACK_PER_LEVEL);
  });

  test("Knockback adds flat melee impulse and Looting reports its level (0 when absent)", () => {
    const sword = createSlot("diamond_sword", 1);
    expect(knockbackBonus(sword)).toBe(0);
    expect(lootingLevel(sword)).toBe(0);
    expect(knockbackBonus(withEnchant("knockback", 2, sword))).toBe(2 * KNOCKBACK_PER_LEVEL);
    expect(lootingLevel(withEnchant("looting", 3, sword))).toBe(3);
  });

  test("Efficiency multiplies mining speed", () => {
    const plain = createSlot("diamond_pickaxe", 1);
    const enchanted = withEnchant("efficiency", 1, plain);
    expect(efficiencyMultiplier(plain)).toBe(1);
    expect(miningSpeed(enchanted)).toBeCloseTo(miningSpeed(plain) * (1 + EFFICIENCY_SPEED_PER_LEVEL), 5);
  });

  test("Protection raises equipped defense and damage reduction", () => {
    const plain: EquippedArmor = { ...createEmptyArmorEquipment(), helmet: createSlot("helmet", 1) };
    const enchanted: EquippedArmor = { ...createEmptyArmorEquipment(), helmet: withEnchant("protection", 2, createSlot("helmet", 1)) };
    expect(equippedDefense(enchanted)).toBeGreaterThan(equippedDefense(plain));
    expect(armorReduction(enchanted)).toBeGreaterThan(armorReduction(plain));
  });
});

describe("Unbreaking", () => {
  test("a roll under level × skip chance skips wear, otherwise it wears (and no rng always wears)", () => {
    const tool = withEnchant("unbreaking", 3, createSlot("diamond_pickaxe", 1)); // skip chance 0.6
    const slots = [tool];
    const max = tool.maxDurability!;

    expect(unbreakingSkips(tool, () => 0)).toBe(true);
    expect(consumeToolDurability(slots, 0, 1, () => 0)).toBeNull(); // saved — no change

    expect(unbreakingSkips(tool, () => 0.99)).toBe(false);
    expect(consumeToolDurability(slots, 0, 1, () => 0.99)?.[0].durability).toBe(max - 1);

    // Back-compat: without an rng, Unbreaking never triggers.
    expect(consumeToolDurability(slots, 0, 1)?.[0].durability).toBe(max - 1);
  });
});

describe("Mending (mendXp)", () => {
  const damaged = (id: string, missing: number): InventorySlot => {
    const slot = applyEnchant(createSlot(id, 1), "mending");
    slot.durability = slot.maxDurability! - missing;
    return slot;
  };
  const noArmor = createEmptyArmorEquipment();

  test("repairs the held item first, capping at max durability and returning the XP left", () => {
    const missing = 6;
    const slots = [damaged("diamond_pickaxe", missing)];
    const xpNeeded = Math.ceil(missing / MENDING_REPAIR_PER_XP); // 3
    const result = mendXp(slots, 0, noArmor, xpNeeded + 4);
    expect(result.slots[0].durability).toBe(slots[0].maxDurability!); // fully repaired
    expect(result.xpLeft).toBe(4);
    expect(result.slots).not.toBe(slots); // cloned on write
  });

  test("never repairs above max and never goes negative on XP", () => {
    const slots = [damaged("diamond_pickaxe", 2)];
    const result = mendXp(slots, 0, noArmor, 100);
    expect(result.slots[0].durability).toBe(slots[0].maxDurability);
    expect(result.xpLeft).toBe(100 - Math.ceil(2 / MENDING_REPAIR_PER_XP));
  });

  test("falls through to worn Mending armor after the held item", () => {
    const helmet = damaged("helmet", 4);
    const slots = [createSlot("diamond_sword", 1)]; // held sword has no mending
    const equipped: EquippedArmor = { ...noArmor, helmet };
    const result = mendXp(slots, 0, equipped, 50);
    expect(result.equipped.helmet!.durability).toBe(helmet.maxDurability);
  });

  test("no Mending gear → same array ref and full XP banked", () => {
    const slots = [createSlot("diamond_pickaxe", 1)];
    const result = mendXp(slots, 0, noArmor, 9);
    expect(result.slots).toBe(slots);
    expect(result.xpLeft).toBe(9);
  });
});
