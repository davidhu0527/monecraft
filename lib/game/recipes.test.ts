import { describe, expect, test } from "bun:test";
import { createEmptySlot, createSlot, ITEM_DEF_BY_ID } from "@/lib/game/items";
import { canCraft, countsById, craft } from "@/lib/game/inventory";
import { groupRecipes, recipeCategory, RECIPE_CATEGORY_ORDER, RECIPES } from "@/lib/game/recipes";
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

describe("recipe categories", () => {
  test("recipeCategory assigns each recipe to the right section", () => {
    expect(recipeCategory(recipe("stone_pickaxe"))).toBe("Tools");
    expect(recipeCategory(recipe("diamond_sword"))).toBe("Weapons");
    expect(recipeCategory(recipe("helmet"))).toBe("Armor");
    expect(recipeCategory(recipe("door"))).toBe("Building");
    expect(recipeCategory(recipe("bread"))).toBe("Food");
    expect(recipeCategory(recipe("wool_from_string"))).toBe("Materials");
    // Station takes precedence: a cooked-meat recipe produces food but smelts at a furnace.
    expect(recipeCategory(recipe("cook_chicken"))).toBe("Smelting");
    expect(recipeCategory(recipe("charcoal"))).toBe("Smelting");
    const trade = RECIPES.find((r) => r.station === "villager")!;
    expect(recipeCategory(trade)).toBe("Trades");
  });

  test("brewing recipes group under Brewing; the stand and bottle are plain crafting", () => {
    const brewing = RECIPES.filter((r) => r.station === "brewing");
    expect(brewing.length).toBeGreaterThanOrEqual(5);
    for (const r of brewing) expect(recipeCategory(r)).toBe("Brewing");
    // The stand and the glass bottle are crafted on the grid, not at a station.
    expect(recipe("brewing_stand").station).toBeUndefined();
    expect(recipeCategory(recipe("brewing_stand"))).toBe("Building");
    expect(recipe("empty_bottle").station).toBeUndefined();
  });

  test("the enchanting table is a plain Building recipe (enchanting isn't recipe-gated)", () => {
    expect(recipe("enchanting_table").station).toBeUndefined();
    expect(recipeCategory(recipe("enchanting_table"))).toBe("Building");
  });

  test("groupRecipes returns non-empty categories in the fixed display order", () => {
    const groups = groupRecipes(RECIPES, () => false);
    const positions = groups.map((g) => RECIPE_CATEGORY_ORDER.indexOf(g.category));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(groups.every((g) => g.recipes.length > 0)).toBe(true);
  });

  test("groupRecipes partitions every recipe exactly once", () => {
    const groups = groupRecipes(RECIPES, () => true);
    const ids = groups.flatMap((g) => g.recipes.map((r) => r.id));
    expect(ids).toHaveLength(RECIPES.length);
    expect(new Set(ids).size).toBe(RECIPES.length);
  });

  test("groupRecipes floats craftable-now recipes to the front, preserving source order", () => {
    const ready = new Set(["stone_pickaxe", "diamond_pickaxe"]);
    const tools = groupRecipes(RECIPES, (r) => ready.has(r.id)).find((g) => g.category === "Tools")!;
    const ids = tools.recipes.map((r) => r.id);
    expect(ids.slice(0, 2)).toEqual(["stone_pickaxe", "diamond_pickaxe"]);
    expect(ids.slice(2).some((id) => ready.has(id))).toBe(false);
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
  test("raw beef smelts into cooked beef with coal at a furnace", () => {
    const r = recipe("cook_beef");
    expect(r.station).toBe("furnace");
    const slots = inventory([
      ["raw_beef", 1],
      ["coal", 1]
    ]);
    expect(canCraft(slots, r)).toBe(true);
    const next = craft(slots, r);
    expect(next).not.toBeNull();
    expect(countsById(next!).get("cooked_beef")).toBe(1);
  });

  test("raw porkchop smelts into cooked porkchop with coal at a furnace", () => {
    const r = recipe("cook_porkchop");
    expect(r.station).toBe("furnace");
    const slots = inventory([
      ["raw_porkchop", 1],
      ["coal", 1]
    ]);
    expect(canCraft(slots, r)).toBe(true);
    const next = craft(slots, r);
    expect(next).not.toBeNull();
    expect(countsById(next!).get("cooked_porkchop")).toBe(1);
  });
});

describe("living world recipes", () => {
  test("bone meal grinds from a single bone in the Materials section", () => {
    const r = recipe("bone_meal");
    expect(r.station).toBeUndefined();
    expect(recipeCategory(r)).toBe("Materials");
    const slots = inventory([["bone", 1]]);
    expect(canCraft(slots, r)).toBe(true);
    expect(countsById(craft(slots, r)!).get("bone_meal")).toBe(r.result.count);
  });
});

describe("fishing recipes", () => {
  test("a fishing rod crafts from wood and string in the Tools section", () => {
    const r = recipe("fishing_rod");
    expect(recipeCategory(r)).toBe("Tools");
    const slots = inventory([
      ["wood", 3],
      ["string", 2]
    ]);
    expect(canCraft(slots, r)).toBe(true);
    expect(countsById(craft(slots, r)!).get("fishing_rod")).toBe(1);
  });

  test("raw fish smelts into cooked fish with coal (or charcoal) at a furnace", () => {
    const r = recipe("cook_fish");
    expect(r.station).toBe("furnace");
    expect(recipeCategory(r)).toBe("Smelting");
    const slots = inventory([
      ["raw_fish", 1],
      ["coal", 1]
    ]);
    expect(canCraft(slots, r)).toBe(true);
    expect(countsById(craft(slots, r)!).get("cooked_fish")).toBe(1);
    expect(
      countsById(
        craft(
          inventory([
            ["raw_fish", 1],
            ["charcoal", 1]
          ]),
          recipe("cook_fish_charcoal")
        )!
      ).get("cooked_fish")
    ).toBe(1);
  });
});

describe("coal & fuel economy", () => {
  test("charcoal smelts from a single wood at a furnace", () => {
    const r = recipe("charcoal");
    expect(r.station).toBe("furnace");
    const slots = inventory([["wood", 1]]);
    expect(canCraft(slots, r)).toBe(true);
    expect(countsById(craft(slots, r)!).get("charcoal")).toBe(1);
  });

  test("cooking accepts charcoal as an alternative fuel", () => {
    const slots = inventory([
      ["raw_chicken", 1],
      ["charcoal", 1]
    ]);
    const r = recipe("cook_chicken_charcoal");
    expect(canCraft(slots, r)).toBe(true);
    expect(countsById(craft(slots, r)!).get("cooked_chicken")).toBe(1);
  });

  test("TNT crafts from gunpowder and sand", () => {
    const r = recipe("tnt");
    const slots = inventory([
      ["gunpowder", 4],
      ["sand", 1]
    ]);
    expect(canCraft(slots, r)).toBe(true);
    expect(countsById(craft(slots, r)!).get("tnt")).toBe(1);
    expect(canCraft(inventory([["gunpowder", 3]]), r)).toBe(false);
  });

  test("torches now require coal (or charcoal) plus wood", () => {
    const r = recipe("torch");
    expect(r.cost.some((c) => c.slotId === "coal")).toBe(true);
    // Wood alone no longer crafts a torch.
    expect(canCraft(inventory([["wood", 1]]), r)).toBe(false);
    expect(
      canCraft(
        inventory([
          ["coal", 1],
          ["wood", 1]
        ]),
        r
      )
    ).toBe(true);
    // The charcoal variant yields the same four torches.
    expect(
      countsById(
        craft(
          inventory([
            ["charcoal", 1],
            ["wood", 1]
          ]),
          recipe("torch_charcoal")
        )!
      ).get("torch")
    ).toBe(4);
  });
});
