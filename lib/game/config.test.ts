import { describe, expect, test } from "bun:test";
import {
  ARMOR_SLOTS,
  ARMOR_SLOT_LABELS,
  BLOCK_TO_SLOT,
  BREAK_HARDNESS,
  INVENTORY_SLOTS,
  ITEM_DEFS,
  ITEM_DEF_BY_ID,
  MAX_STACK_SIZE,
  RECIPES,
  createEmptyArmorEquipment,
  createInitialInventory,
  createSlot
} from "@/lib/game/config";

describe("item definitions", () => {
  test("item ids are unique", () => {
    const ids = ITEM_DEFS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("tools, weapons, and armor all have positive durability", () => {
    for (const item of ITEM_DEFS) {
      if (item.kind === "tool" || item.kind === "weapon" || item.kind === "armor") {
        expect(item.maxDurability ?? 0).toBeGreaterThan(0);
      }
    }
  });

  test("armor items reference valid armor slots, and every slot has a label", () => {
    for (const item of ITEM_DEFS) {
      if (item.kind === "armor") {
        expect(item.armorSlot).toBeDefined();
        expect(ARMOR_SLOTS).toContain(item.armorSlot!);
      }
    }
    for (const slot of ARMOR_SLOTS) expect(ARMOR_SLOT_LABELS[slot]).toBeTruthy();
    expect(Object.keys(createEmptyArmorEquipment()).sort()).toEqual([...ARMOR_SLOTS].sort());
  });
});

describe("recipes", () => {
  test("recipe ids are unique", () => {
    const ids = RECIPES.map((recipe) => recipe.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every cost and result references an existing item with a positive count", () => {
    for (const recipe of RECIPES) {
      for (const cost of recipe.cost) {
        expect(ITEM_DEF_BY_ID[cost.slotId]).toBeDefined();
        expect(cost.count).toBeGreaterThan(0);
      }
      expect(ITEM_DEF_BY_ID[recipe.result.slotId]).toBeDefined();
      expect(recipe.result.count).toBeGreaterThan(0);
      expect(recipe.result.count).toBeLessThanOrEqual(MAX_STACK_SIZE);
    }
  });
});

describe("block drops", () => {
  test("every droppable block maps to an existing item", () => {
    for (const itemId of Object.values(BLOCK_TO_SLOT)) {
      expect(ITEM_DEF_BY_ID[itemId!]).toBeDefined();
    }
  });

  test("every droppable block has a break hardness", () => {
    for (const blockId of Object.keys(BLOCK_TO_SLOT)) {
      expect(BREAK_HARDNESS[Number(blockId) as keyof typeof BREAK_HARDNESS]).toBeGreaterThan(0);
    }
  });
});

describe("slot factories", () => {
  test("createSlot copies the item definition and initializes durability for gear", () => {
    const pickaxe = createSlot("wood_pickaxe", 1);
    expect(pickaxe.id).toBe("wood_pickaxe");
    expect(pickaxe.count).toBe(1);
    expect(pickaxe.durability).toBe(pickaxe.maxDurability);
    expect(pickaxe.durability).toBeGreaterThan(0);

    const dirt = createSlot("dirt", 5);
    expect(dirt.durability).toBeUndefined();
  });

  test("createSlot returns an empty slot for unknown item ids", () => {
    const slot = createSlot("no_such_item", 3);
    expect(slot.id).toBeNull();
    expect(slot.count).toBe(0);
  });

  test("initial inventory has the right size and only valid items", () => {
    const slots = createInitialInventory();
    expect(slots).toHaveLength(INVENTORY_SLOTS);
    for (const slot of slots) {
      if (slot.id !== null) {
        expect(ITEM_DEF_BY_ID[slot.id]).toBeDefined();
        expect(slot.count).toBeGreaterThan(0);
        expect(slot.count).toBeLessThanOrEqual(MAX_STACK_SIZE);
      }
    }
  });
});
