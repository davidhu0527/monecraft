import { describe, expect, test } from "bun:test";
import { createEmptySlot, createSlot, ITEM_DEF_BY_ID } from "@/lib/game/items";
import { canCraft, countsById, craft } from "@/lib/game/inventory";
import { RECIPES } from "@/lib/game/recipes";
import type { InventorySlot } from "@/lib/game/types";

function inventory(items: Array<[string, number]>): InventorySlot[] {
  const slots = Array.from({ length: 12 }, () => createEmptySlot());
  items.forEach(([id, count], i) => {
    slots[i] = createSlot(id, count);
  });
  return slots;
}

const recipe = (id: string) => {
  const found = RECIPES.find((r) => r.id === id);
  if (!found) throw new Error(`recipe ${id} not found`);
  return found;
};

describe("recipe integrity", () => {
  test("every recipe references only real item ids", () => {
    for (const r of RECIPES) {
      for (const cost of r.cost) expect(ITEM_DEF_BY_ID[cost.slotId], `${r.id} cost ${cost.slotId}`).toBeDefined();
      expect(ITEM_DEF_BY_ID[r.result.slotId], `${r.id} result ${r.result.slotId}`).toBeDefined();
    }
  });
});

describe("ranged recipes", () => {
  test("a bow is craftable from wood + string", () => {
    const slots = inventory([
      ["wood", 3],
      ["string", 3]
    ]);
    expect(canCraft(slots, recipe("bow"))).toBe(true);
    const next = craft(slots, recipe("bow"));
    expect(next).not.toBeNull();
    expect(countsById(next!).get("bow")).toBe(1);
  });

  test("arrows craft four at a time from stone + wood + feather", () => {
    const slots = inventory([
      ["stone", 1],
      ["wood", 1],
      ["feather", 1]
    ]);
    expect(canCraft(slots, recipe("arrow"))).toBe(true);
    const next = craft(slots, recipe("arrow"));
    expect(next).not.toBeNull();
    expect(countsById(next!).get("arrow")).toBe(4);
  });

  test("a bow cannot be crafted without enough string", () => {
    const slots = inventory([
      ["wood", 3],
      ["string", 2]
    ]);
    expect(canCraft(slots, recipe("bow"))).toBe(false);
  });
});

describe("cooking new meats", () => {
  test("raw beef smelts into cooked beef at a furnace", () => {
    const r = recipe("cook_beef");
    expect(r.station).toBe("furnace");
    const slots = inventory([
      ["raw_beef", 1],
      ["planks", 1]
    ]);
    expect(canCraft(slots, r)).toBe(true);
    const next = craft(slots, r);
    expect(next).not.toBeNull();
    expect(countsById(next!).get("cooked_beef")).toBe(1);
  });

  test("raw porkchop smelts into cooked porkchop at a furnace", () => {
    const r = recipe("cook_porkchop");
    expect(r.station).toBe("furnace");
    const slots = inventory([
      ["raw_porkchop", 1],
      ["planks", 1]
    ]);
    expect(canCraft(slots, r)).toBe(true);
    const next = craft(slots, r);
    expect(next).not.toBeNull();
    expect(countsById(next!).get("cooked_porkchop")).toBe(1);
  });
});
