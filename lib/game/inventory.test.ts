import { describe, expect, test } from "bun:test";
import { INVENTORY_SLOTS, MAX_STACK_SIZE } from "@/lib/game/config";
import { createEmptyArmorEquipment, createEmptySlot, createSlot } from "@/lib/game/items";
import { RECIPES } from "@/lib/game/recipes";
import {
  adjustSlotCount,
  armorReduction,
  equippedDefense,
  canCraft,
  consumeEquippedArmorDurability,
  consumeToolDurability,
  countsById,
  craft,
  moveStack,
  swapSlots,
  toggleEquipArmor,
  tryInsertSlots,
  unequipMissingArmor
} from "@/lib/game/inventory";
import type { InventorySlot } from "@/lib/game/types";

function makeSlots(...items: Array<[string, number] | null>): InventorySlot[] {
  const slots = Array.from({ length: INVENTORY_SLOTS }, () => createEmptySlot());
  items.forEach((item, i) => {
    if (item) slots[i] = createSlot(item[0], item[1]);
  });
  return slots;
}

const planksRecipe = RECIPES.find((recipe) => recipe.id === "planks")!; // 2 wood -> 4 planks
const brickRecipe = RECIPES.find((recipe) => recipe.id === "brick")!; // 2 dirt + 2 stone -> 2 brick

describe("countsById", () => {
  test("sums across stacks and skips empties", () => {
    const slots = makeSlots(["dirt", 30], ["stone", 5], null, ["dirt", 12]);
    const byId = countsById(slots);
    expect(byId.get("dirt")).toBe(42);
    expect(byId.get("stone")).toBe(5);
    expect(byId.has("")).toBe(false);
  });
});

describe("adjustSlotCount", () => {
  test("removal drains the preferred slot first, then scans", () => {
    const slots = makeSlots(["dirt", 10], ["dirt", 10]);
    const next = adjustSlotCount(slots, "dirt", -12, 1)!;
    expect(next[1].count).toBe(0);
    expect(next[1].id).toBeNull();
    expect(next[0].count).toBe(8);
  });

  test("removal is all-or-nothing when short", () => {
    const slots = makeSlots(["dirt", 5]);
    expect(adjustSlotCount(slots, "dirt", -6)).toBeNull();
    expect(slots[0].count).toBe(5); // input untouched
  });

  test("addition fills existing stacks then empty slots", () => {
    const slots = makeSlots(["dirt", MAX_STACK_SIZE - 2]);
    const next = adjustSlotCount(slots, "dirt", 5)!;
    expect(next[0].count).toBe(MAX_STACK_SIZE);
    expect(next[1].id).toBe("dirt");
    expect(next[1].count).toBe(3);
  });

  test("addition drops surplus when the inventory is full", () => {
    const slots = Array.from({ length: INVENTORY_SLOTS }, () => createSlot("stone", MAX_STACK_SIZE));
    const next = adjustSlotCount(slots, "dirt", 10)!;
    expect(countsById(next).get("dirt")).toBeUndefined();
  });

  test("durable gear occupies one slot per item", () => {
    const next = adjustSlotCount(makeSlots(), "diamond_sword", 3)!;
    expect(next.filter((slot) => slot.id === "diamond_sword")).toHaveLength(3);
    expect(next.filter((slot) => slot.id === "diamond_sword").every((slot) => slot.count === 1)).toBe(true);
  });

  test("unknown items and zero deltas are no-ops", () => {
    const slots = makeSlots(["dirt", 5]);
    expect(adjustSlotCount(slots, "no_such_item", 3)).toBeNull();
    expect(adjustSlotCount(slots, "dirt", 0)).toBeNull();
  });

  test("never mutates the input array", () => {
    const slots = makeSlots(["dirt", 10]);
    adjustSlotCount(slots, "dirt", -4);
    adjustSlotCount(slots, "dirt", 4);
    expect(slots[0].count).toBe(10);
  });
});

describe("durability", () => {
  test("tool wears down and breaks at zero", () => {
    let slots = makeSlots(["wood_pickaxe", 1]);
    const max = slots[0].maxDurability!;
    slots = consumeToolDurability(slots, 0, max - 1)!;
    expect(slots[0].durability).toBe(1);
    slots = consumeToolDurability(slots, 0, 1)!;
    expect(slots[0].id).toBeNull(); // broke
  });

  test("blocks have no durability to consume", () => {
    const slots = makeSlots(["dirt", 5]);
    expect(consumeToolDurability(slots, 0, 1)).toBeNull();
  });

  test("equipped armor wears together; broken pieces vanish", () => {
    let slots = makeSlots(["helmet", 1], ["boots", 1]);
    const equipped = { ...createEmptyArmorEquipment(), helmet: "helmet", boots: "boots" };
    slots = consumeEquippedArmorDurability(slots, equipped, slots[1].maxDurability! - 1)!;
    expect(slots[0].durability).toBe(slots[0].maxDurability! - (slots[1].maxDurability! - 1));
    expect(slots[1].durability).toBe(1);
    slots = consumeEquippedArmorDurability(slots, equipped, 1)!;
    expect(slots[1].id).toBeNull(); // boots broke, helmet survives
    expect(slots[0].id).toBe("helmet");
  });

  test("nothing equipped is a no-op", () => {
    const slots = makeSlots(["helmet", 1]);
    expect(consumeEquippedArmorDurability(slots, createEmptyArmorEquipment(), 1)).toBeNull();
  });
});

describe("tryInsertSlots", () => {
  test("merges stackables into existing stacks then empty slots", () => {
    const inv = makeSlots(["dirt", MAX_STACK_SIZE - 2]);
    const next = tryInsertSlots(inv, [createSlot("dirt", 5)])!;
    expect(next[0].count).toBe(MAX_STACK_SIZE);
    expect(next[1].id).toBe("dirt");
    expect(next[1].count).toBe(3);
  });

  test("durability items take a whole slot each and keep their durability", () => {
    const inv = makeSlots();
    const pick: InventorySlot = { ...createSlot("wood_pickaxe", 1), durability: 7 };
    const next = tryInsertSlots(inv, [pick, createSlot("knife", 1)])!;
    const placedPick = next.find((slot) => slot.id === "wood_pickaxe")!;
    expect(placedPick.durability).toBe(7);
    expect(next.some((slot) => slot.id === "knife")).toBe(true);
  });

  test("is all-or-nothing: returns null and touches nothing when short on room", () => {
    const full = Array.from({ length: INVENTORY_SLOTS }, () => createSlot("stone", MAX_STACK_SIZE));
    expect(tryInsertSlots(full, [createSlot("dirt", 1)])).toBeNull();
    expect(full[0].id).toBe("stone"); // input untouched
  });

  test("skips empty and unknown incoming slots", () => {
    const inv = makeSlots(["dirt", 1]);
    const next = tryInsertSlots(inv, [createEmptySlot(), { id: "ghost", label: "Ghost", kind: "material", count: 4 }])!;
    expect(countsById(next).get("dirt")).toBe(1);
    expect(countsById(next).get("ghost")).toBeUndefined();
  });
});

describe("crafting", () => {
  test("canCraft needs both the cost and room for the result", () => {
    expect(canCraft(makeSlots(["wood", 2]), planksRecipe)).toBe(true);
    expect(canCraft(makeSlots(["wood", 1]), planksRecipe)).toBe(false);

    // Cost present but zero room for the result.
    const full = Array.from({ length: INVENTORY_SLOTS }, () => createSlot("stone", MAX_STACK_SIZE));
    full[0] = createSlot("wood", MAX_STACK_SIZE);
    expect(canCraft(full, planksRecipe)).toBe(false);
  });

  test("craft consumes the cost and adds the result", () => {
    const next = craft(makeSlots(["dirt", 10], ["stone", 10]), brickRecipe)!;
    const byId = countsById(next);
    expect(byId.get("dirt")).toBe(8);
    expect(byId.get("stone")).toBe(8);
    expect(byId.get("brick")).toBe(2);
  });

  test("craft refuses instead of destroying overflow when the inventory is full", () => {
    const full = Array.from({ length: INVENTORY_SLOTS }, () => createSlot("stone", MAX_STACK_SIZE));
    full[0] = createSlot("wood", MAX_STACK_SIZE);
    expect(craft(full, planksRecipe)).toBeNull(); // cost NOT consumed
  });

  test("crafted gear gets fresh durability", () => {
    const next = craft(makeSlots(["planks", 4], ["wood", 4]), RECIPES.find((recipe) => recipe.id === "wood_pickaxe")!)!;
    const pick = next.find((slot) => slot.id === "wood_pickaxe")!;
    expect(pick.durability).toBe(pick.maxDurability);
  });

  test("crafted gear needs an empty slot instead of merging", () => {
    const recipe = RECIPES.find((entry) => entry.id === "wood_spear")!;
    const full = Array.from({ length: INVENTORY_SLOTS }, () => createSlot("stone", MAX_STACK_SIZE));
    full[0] = createSlot("wood", MAX_STACK_SIZE);
    full[1] = createSlot("planks", MAX_STACK_SIZE);
    full[2] = createSlot("wood_spear", 1);
    expect(canCraft(full, recipe)).toBe(false);
    expect(craft(full, recipe)).toBeNull();
  });
});

describe("swap and armor", () => {
  test("swapSlots exchanges two slots and rejects bad indices", () => {
    const slots = makeSlots(["dirt", 5], ["stone", 7]);
    const next = swapSlots(slots, 0, 1)!;
    expect(next[0].id).toBe("stone");
    expect(next[1].id).toBe("dirt");
    expect(swapSlots(slots, 0, 0)).toBeNull();
    expect(swapSlots(slots, 0, INVENTORY_SLOTS)).toBeNull();
  });

  test("moveStack swaps across two arrays and writes both back", () => {
    const player = makeSlots(["dirt", 5]);
    const chest = makeSlots(["stone", 7]);
    const moved = moveStack(player, 0, chest, 0)!;
    expect(moved.a[0].id).toBe("stone");
    expect(moved.b[0].id).toBe("dirt");
    expect(player[0].id).toBe("dirt"); // inputs untouched
    expect(chest[0].id).toBe("stone");
  });

  test("moveStack within one array degrades to a swap (a === b)", () => {
    const slots = makeSlots(["dirt", 5], ["stone", 7]);
    const moved = moveStack(slots, 0, slots, 1)!;
    expect(moved.a).toBe(moved.b); // same array returned for both
    expect(moved.a[0].id).toBe("stone");
    expect(moved.a[1].id).toBe("dirt");
    expect(moveStack(slots, 0, slots, 0)).toBeNull(); // no-op
    expect(moveStack(slots, 0, makeSlots(), INVENTORY_SLOTS)).toBeNull(); // out of range
  });

  test("moveStack preserves durability of a moved tool", () => {
    const player = makeSlots(["wood_pickaxe", 1]);
    player[0] = { ...player[0], durability: 12 };
    const chest = makeSlots();
    const moved = moveStack(player, 0, chest, 0)!;
    expect(moved.b[0].id).toBe("wood_pickaxe");
    expect(moved.b[0].durability).toBe(12);
  });

  test("toggleEquipArmor equips then unequips", () => {
    const slots = makeSlots(["helmet", 1]);
    const empty = createEmptyArmorEquipment();
    const equipped = toggleEquipArmor(slots, empty, 0)!;
    expect(equipped.helmet).toBe("helmet");
    const unequipped = toggleEquipArmor(slots, equipped, 0)!;
    expect(unequipped.helmet).toBeNull();
    expect(toggleEquipArmor(makeSlots(["dirt", 1]), empty, 0)).toBeNull();
  });

  test("unequipMissingArmor clears pieces that left the inventory", () => {
    const equipped = { ...createEmptyArmorEquipment(), helmet: "helmet", boots: "boots" };
    const slots = makeSlots(["helmet", 1]); // boots gone
    const next = unequipMissingArmor(slots, equipped)!;
    expect(next.helmet).toBe("helmet");
    expect(next.boots).toBeNull();
    expect(unequipMissingArmor(slots, next)).toBeNull(); // already consistent
  });

  test("armorReduction is 5% per defense point, capped, and requires owned pieces", () => {
    const slots = makeSlots(["helmet", 1], ["chestplate", 1]);
    const equipped = { ...createEmptyArmorEquipment(), helmet: "helmet", chestplate: "chestplate" };
    expect(armorReduction(slots, equipped)).toBeCloseTo((2 + 4) * 0.05);
    // Equipped but not owned counts for nothing.
    expect(armorReduction(makeSlots(["helmet", 1]), equipped)).toBeCloseTo(2 * 0.05);
    expect(armorReduction(slots, createEmptyArmorEquipment())).toBe(0);
  });

  test("equippedDefense sums defense points of owned equipped pieces", () => {
    const slots = makeSlots(["helmet", 1], ["chestplate", 1]);
    const equipped = { ...createEmptyArmorEquipment(), helmet: "helmet", chestplate: "chestplate" };
    expect(equippedDefense(slots, equipped)).toBe(2 + 4);
    expect(equippedDefense(makeSlots(["helmet", 1]), equipped)).toBe(2);
    expect(equippedDefense(slots, createEmptyArmorEquipment())).toBe(0);
  });
});
