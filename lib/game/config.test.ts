import { describe, expect, test } from "bun:test";
import { BlockId } from "@/lib/world";
import { INVENTORY_SLOTS, MAX_STACK_SIZE } from "@/lib/game/config";
import {
  ARMOR_SLOTS,
  ARMOR_SLOT_LABELS,
  BLOCK_TO_SLOT,
  BREAK_HARDNESS,
  ITEM_DEFS,
  ITEM_DEF_BY_ID,
  createEmptyArmorEquipment,
  createInitialInventory,
  createSlot,
  rollBlockDrops
} from "@/lib/game/items";
import { RECIPES } from "@/lib/game/recipes";

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

  test("every spear has long melee reach and throw damage", () => {
    const spears = ITEM_DEFS.filter((item) => item.id.endsWith("_spear"));
    expect(spears).toHaveLength(7);
    for (const spear of spears) {
      expect(spear.meleeReach).toBeGreaterThan(4.5);
      expect(spear.throwDamage).toBeGreaterThan(spear.attack ?? 0);
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

  test("station recipes name a known station", () => {
    const stations = ["furnace", "villager", "brewing"];
    for (const recipe of RECIPES) {
      if (recipe.station) expect(stations).toContain(recipe.station);
    }
  });

  test("every spear tier has a recipe", () => {
    for (const item of ITEM_DEFS.filter((entry) => entry.id.endsWith("_spear"))) {
      expect(RECIPES.some((recipe) => recipe.result.slotId === item.id)).toBe(true);
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

describe("block drop rolls", () => {
  test("grass drops itself, and a seed on a low roll", () => {
    expect(rollBlockDrops(BlockId.Grass, () => 0.9)).toEqual([{ itemId: "grass", count: 1 }]);
    const lucky = rollBlockDrops(BlockId.Grass, () => 0);
    expect(lucky).toContainEqual({ itemId: "grass", count: 1 });
    expect(lucky).toContainEqual({ itemId: "seeds", count: 1 });
  });

  test("mature wheat drops wheat and 1-2 seeds", () => {
    const min = rollBlockDrops(BlockId.WheatStage3, () => 0);
    expect(min).toContainEqual({ itemId: "wheat", count: 1 });
    expect(min.find((d) => d.itemId === "seeds")!.count).toBe(1);
    const max = rollBlockDrops(BlockId.WheatStage3, () => 0.999);
    expect(max.find((d) => d.itemId === "seeds")!.count).toBe(2);
  });

  test("immature wheat returns just a seed", () => {
    expect(rollBlockDrops(BlockId.WheatStage1, () => 0.5)).toEqual([{ itemId: "seeds", count: 1 }]);
  });

  test("leaves drop a sapling on a low roll, nothing on a high roll", () => {
    expect(rollBlockDrops(BlockId.Leaves, () => 0)).toEqual([{ itemId: "sapling", count: 1 }]);
    expect(rollBlockDrops(BlockId.Leaves, () => 0.99)).toEqual([]);
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
