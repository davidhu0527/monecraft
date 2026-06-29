import { BONE_MEAL_PER_BONE } from "@/lib/game/config";
import { ITEM_DEF_BY_ID } from "@/lib/game/items";
import { TRADES } from "@/lib/game/trades";
import type { ItemKind, Recipe } from "@/lib/game/types";

const CRAFTING_RECIPES: Recipe[] = [
  { id: "planks", label: "2 Wood -> 4 Planks", cost: [{ slotId: "wood", count: 2 }], result: { slotId: "planks", count: 4 } },
  { id: "wool_from_string", label: "4 String -> 1 Wool", cost: [{ slotId: "string", count: 4 }], result: { slotId: "wool", count: 1 } },
  {
    id: "bed",
    label: "3 Wool + 3 Planks -> Bed",
    cost: [
      { slotId: "wool", count: 3 },
      { slotId: "planks", count: 3 }
    ],
    result: { slotId: "bed", count: 1 }
  },
  {
    id: "wood_hoe",
    label: "2 Planks + 1 Wood -> Wood Hoe",
    cost: [
      { slotId: "planks", count: 2 },
      { slotId: "wood", count: 1 }
    ],
    result: { slotId: "wood_hoe", count: 1 }
  },
  { id: "bread", label: "3 Wheat -> Bread", cost: [{ slotId: "wheat", count: 3 }], result: { slotId: "bread", count: 1 } },
  {
    id: "bone_meal",
    label: `1 Bone -> ${BONE_MEAL_PER_BONE} Bone Meal`,
    cost: [{ slotId: "bone", count: 1 }],
    result: { slotId: "bone_meal", count: BONE_MEAL_PER_BONE }
  },
  { id: "furnace", label: "8 Cobble -> Furnace", cost: [{ slotId: "cobble", count: 8 }], result: { slotId: "furnace", count: 1 } },
  { id: "chest", label: "8 Planks -> Chest", cost: [{ slotId: "planks", count: 8 }], result: { slotId: "chest", count: 1 } },
  {
    id: "brewing_stand",
    label: "3 Cobble + 1 Gold Ore -> Brewing Stand",
    cost: [
      { slotId: "cobble", count: 3 },
      { slotId: "gold_ore", count: 1 }
    ],
    result: { slotId: "brewing_stand", count: 1 }
  },
  {
    id: "enchanting_table",
    label: "2 Diamond Ore + 4 Cobble -> Enchanting Table",
    cost: [
      { slotId: "diamond_ore", count: 2 },
      { slotId: "cobble", count: 4 }
    ],
    result: { slotId: "enchanting_table", count: 1 }
  },
  {
    id: "anvil",
    label: "3 Gold Ore + 4 Cobble -> Anvil",
    cost: [
      { slotId: "gold_ore", count: 3 },
      { slotId: "cobble", count: 4 }
    ],
    result: { slotId: "anvil", count: 1 }
  },
  {
    id: "grindstone",
    label: "2 Cobble + 2 Planks -> Grindstone",
    cost: [
      { slotId: "cobble", count: 2 },
      { slotId: "planks", count: 2 }
    ],
    result: { slotId: "grindstone", count: 1 }
  },
  { id: "door", label: "6 Planks -> Wood Door", cost: [{ slotId: "planks", count: 6 }], result: { slotId: "door", count: 1 } },
  {
    id: "torch",
    label: "1 Coal + 1 Wood -> 4 Torch",
    cost: [
      { slotId: "coal", count: 1 },
      { slotId: "wood", count: 1 }
    ],
    result: { slotId: "torch", count: 4 }
  },
  {
    id: "torch_charcoal",
    label: "1 Charcoal + 1 Wood -> 4 Torch",
    cost: [
      { slotId: "charcoal", count: 1 },
      { slotId: "wood", count: 1 }
    ],
    result: { slotId: "torch", count: 4 }
  },
  // Charcoal: smelt a log into fuel. The furnace is a station gate (it consumes
  // no fuel itself), so this is a straight wood -> charcoal conversion — the
  // bootstrap fuel for a player who hasn't found coal yet.
  { id: "charcoal", label: "1 Wood -> 1 Charcoal", cost: [{ slotId: "wood", count: 1 }], result: { slotId: "charcoal", count: 1 }, station: "furnace" },
  // Cooking burns a fuel ingredient: coal (mined) or charcoal (smelted from wood).
  {
    id: "cook_chicken",
    label: "Raw Chicken + Coal -> Cooked Chicken",
    cost: [
      { slotId: "raw_chicken", count: 1 },
      { slotId: "coal", count: 1 }
    ],
    result: { slotId: "cooked_chicken", count: 1 },
    station: "furnace"
  },
  {
    id: "cook_chicken_charcoal",
    label: "Raw Chicken + Charcoal -> Cooked Chicken",
    cost: [
      { slotId: "raw_chicken", count: 1 },
      { slotId: "charcoal", count: 1 }
    ],
    result: { slotId: "cooked_chicken", count: 1 },
    station: "furnace"
  },
  {
    id: "cook_mutton",
    label: "Raw Mutton + Coal -> Cooked Mutton",
    cost: [
      { slotId: "raw_mutton", count: 1 },
      { slotId: "coal", count: 1 }
    ],
    result: { slotId: "cooked_mutton", count: 1 },
    station: "furnace"
  },
  {
    id: "cook_mutton_charcoal",
    label: "Raw Mutton + Charcoal -> Cooked Mutton",
    cost: [
      { slotId: "raw_mutton", count: 1 },
      { slotId: "charcoal", count: 1 }
    ],
    result: { slotId: "cooked_mutton", count: 1 },
    station: "furnace"
  },
  {
    id: "cook_beef",
    label: "Raw Beef + Coal -> Cooked Beef",
    cost: [
      { slotId: "raw_beef", count: 1 },
      { slotId: "coal", count: 1 }
    ],
    result: { slotId: "cooked_beef", count: 1 },
    station: "furnace"
  },
  {
    id: "cook_beef_charcoal",
    label: "Raw Beef + Charcoal -> Cooked Beef",
    cost: [
      { slotId: "raw_beef", count: 1 },
      { slotId: "charcoal", count: 1 }
    ],
    result: { slotId: "cooked_beef", count: 1 },
    station: "furnace"
  },
  {
    id: "cook_porkchop",
    label: "Raw Porkchop + Coal -> Cooked Porkchop",
    cost: [
      { slotId: "raw_porkchop", count: 1 },
      { slotId: "coal", count: 1 }
    ],
    result: { slotId: "cooked_porkchop", count: 1 },
    station: "furnace"
  },
  {
    id: "cook_porkchop_charcoal",
    label: "Raw Porkchop + Charcoal -> Cooked Porkchop",
    cost: [
      { slotId: "raw_porkchop", count: 1 },
      { slotId: "charcoal", count: 1 }
    ],
    result: { slotId: "cooked_porkchop", count: 1 },
    station: "furnace"
  },
  {
    id: "cook_fish",
    label: "Raw Fish + Coal -> Cooked Fish",
    cost: [
      { slotId: "raw_fish", count: 1 },
      { slotId: "coal", count: 1 }
    ],
    result: { slotId: "cooked_fish", count: 1 },
    station: "furnace"
  },
  {
    id: "cook_fish_charcoal",
    label: "Raw Fish + Charcoal -> Cooked Fish",
    cost: [
      { slotId: "raw_fish", count: 1 },
      { slotId: "charcoal", count: 1 }
    ],
    result: { slotId: "cooked_fish", count: 1 },
    station: "furnace"
  },
  { id: "glass", label: "4 Sand -> 2 Glass", cost: [{ slotId: "sand", count: 4 }], result: { slotId: "glass", count: 2 } },
  { id: "empty_bottle", label: "3 Glass -> 3 Glass Bottle", cost: [{ slotId: "glass", count: 3 }], result: { slotId: "empty_bottle", count: 3 } },
  // Brewing: a glass bottle plus one reagent becomes a potion at a brewing stand.
  // Reagents are existing drops/crops, so no new worldgen — balance is tunable.
  {
    id: "potion_speed",
    label: "Glass Bottle + Feather -> Potion of Swiftness",
    cost: [
      { slotId: "empty_bottle", count: 1 },
      { slotId: "feather", count: 1 }
    ],
    result: { slotId: "potion_speed", count: 1 },
    station: "brewing"
  },
  {
    id: "potion_strength",
    label: "Glass Bottle + Gunpowder -> Potion of Strength",
    cost: [
      { slotId: "empty_bottle", count: 1 },
      { slotId: "gunpowder", count: 1 }
    ],
    result: { slotId: "potion_strength", count: 1 },
    station: "brewing"
  },
  {
    id: "potion_regeneration",
    label: "Glass Bottle + Wheat -> Potion of Regeneration",
    cost: [
      { slotId: "empty_bottle", count: 1 },
      { slotId: "wheat", count: 1 }
    ],
    result: { slotId: "potion_regeneration", count: 1 },
    station: "brewing"
  },
  {
    id: "potion_fire_resistance",
    label: "Glass Bottle + Coal -> Potion of Fire Resistance",
    cost: [
      { slotId: "empty_bottle", count: 1 },
      { slotId: "coal", count: 1 }
    ],
    result: { slotId: "potion_fire_resistance", count: 1 },
    station: "brewing"
  },
  {
    id: "potion_water_breathing",
    label: "Glass Bottle + Raw Fish -> Potion of Water Breathing",
    cost: [
      { slotId: "empty_bottle", count: 1 },
      { slotId: "raw_fish", count: 1 }
    ],
    result: { slotId: "potion_water_breathing", count: 1 },
    station: "brewing"
  },
  {
    id: "potion_haste",
    label: "Glass Bottle + Gold Ore -> Potion of Haste",
    cost: [
      { slotId: "empty_bottle", count: 1 },
      { slotId: "gold_ore", count: 1 }
    ],
    result: { slotId: "potion_haste", count: 1 },
    station: "brewing"
  },
  {
    id: "potion_resistance",
    label: "Glass Bottle + Leather -> Potion of Resistance",
    cost: [
      { slotId: "empty_bottle", count: 1 },
      { slotId: "leather", count: 1 }
    ],
    result: { slotId: "potion_resistance", count: 1 },
    station: "brewing"
  },
  {
    id: "potion_jump_boost",
    label: "Glass Bottle + Sliver Ore -> Potion of Leaping",
    cost: [
      { slotId: "empty_bottle", count: 1 },
      { slotId: "sliver_ore", count: 1 }
    ],
    result: { slotId: "potion_jump_boost", count: 1 },
    station: "brewing"
  },
  {
    id: "tnt",
    label: "4 Gunpowder + 1 Sand -> TNT",
    cost: [
      { slotId: "gunpowder", count: 4 },
      { slotId: "sand", count: 1 }
    ],
    result: { slotId: "tnt", count: 1 }
  },
  {
    id: "brick",
    label: "2 Dirt + 2 Stone -> 2 Brick",
    cost: [
      { slotId: "dirt", count: 2 },
      { slotId: "stone", count: 2 }
    ],
    result: { slotId: "brick", count: 2 }
  },
  {
    id: "wood_pickaxe",
    label: "2 Planks + 2 Wood -> Wood Pickaxe",
    cost: [
      { slotId: "planks", count: 2 },
      { slotId: "wood", count: 2 }
    ],
    result: { slotId: "wood_pickaxe", count: 1 }
  },
  {
    id: "stone_pickaxe",
    label: "2 Cobble + 1 Wood -> Stone Pickaxe",
    cost: [
      { slotId: "cobble", count: 2 },
      { slotId: "wood", count: 1 }
    ],
    result: { slotId: "stone_pickaxe", count: 1 }
  },
  {
    id: "sliver_pickaxe",
    label: "2 Sliver Ore + 1 Wood -> Sliver Pickaxe",
    cost: [
      { slotId: "sliver_ore", count: 2 },
      { slotId: "wood", count: 1 }
    ],
    result: { slotId: "sliver_pickaxe", count: 1 }
  },
  {
    id: "ruby_pickaxe",
    label: "2 Ruby Ore + 1 Wood -> Ruby Pickaxe",
    cost: [
      { slotId: "ruby_ore", count: 2 },
      { slotId: "wood", count: 1 }
    ],
    result: { slotId: "ruby_pickaxe", count: 1 }
  },
  {
    id: "gold_pickaxe",
    label: "2 Gold Ore + 1 Wood -> Gold Pickaxe",
    cost: [
      { slotId: "gold_ore", count: 2 },
      { slotId: "wood", count: 1 }
    ],
    result: { slotId: "gold_pickaxe", count: 1 }
  },
  {
    id: "sapphire_pickaxe",
    label: "2 Sapphire Ore + 1 Wood -> Sapphire Pickaxe",
    cost: [
      { slotId: "sapphire_ore", count: 2 },
      { slotId: "wood", count: 1 }
    ],
    result: { slotId: "sapphire_pickaxe", count: 1 }
  },
  {
    id: "diamond_pickaxe",
    label: "2 Diamond Ore + 1 Wood -> Diamond Pickaxe",
    cost: [
      { slotId: "diamond_ore", count: 2 },
      { slotId: "wood", count: 1 }
    ],
    result: { slotId: "diamond_pickaxe", count: 1 }
  },
  {
    id: "knife",
    label: "1 Stone + 1 Wood -> Knife",
    cost: [
      { slotId: "stone", count: 1 },
      { slotId: "wood", count: 1 }
    ],
    result: { slotId: "knife", count: 1 }
  },
  {
    id: "wood_sword",
    label: "2 Planks + 1 Wood -> Wood Sword",
    cost: [
      { slotId: "planks", count: 2 },
      { slotId: "wood", count: 1 }
    ],
    result: { slotId: "wood_sword", count: 1 }
  },
  {
    id: "stone_sword",
    label: "2 Cobble + 1 Wood -> Stone Sword",
    cost: [
      { slotId: "cobble", count: 2 },
      { slotId: "wood", count: 1 }
    ],
    result: { slotId: "stone_sword", count: 1 }
  },
  {
    id: "sliver_sword",
    label: "2 Sliver Ore + 1 Wood -> Sliver Sword",
    cost: [
      { slotId: "sliver_ore", count: 2 },
      { slotId: "wood", count: 1 }
    ],
    result: { slotId: "sliver_sword", count: 1 }
  },
  {
    id: "ruby_sword",
    label: "2 Ruby Ore + 1 Wood -> Ruby Sword",
    cost: [
      { slotId: "ruby_ore", count: 2 },
      { slotId: "wood", count: 1 }
    ],
    result: { slotId: "ruby_sword", count: 1 }
  },
  {
    id: "gold_sword",
    label: "2 Gold Ore + 1 Wood -> Gold Sword",
    cost: [
      { slotId: "gold_ore", count: 2 },
      { slotId: "wood", count: 1 }
    ],
    result: { slotId: "gold_sword", count: 1 }
  },
  {
    id: "sapphire_sword",
    label: "2 Sapphire Ore + 1 Wood -> Sapphire Sword",
    cost: [
      { slotId: "sapphire_ore", count: 2 },
      { slotId: "wood", count: 1 }
    ],
    result: { slotId: "sapphire_sword", count: 1 }
  },
  {
    id: "diamond_sword",
    label: "2 Diamond Ore + 1 Wood -> Diamond Sword",
    cost: [
      { slotId: "diamond_ore", count: 2 },
      { slotId: "wood", count: 1 }
    ],
    result: { slotId: "diamond_sword", count: 1 }
  },
  {
    id: "wood_spear",
    label: "1 Planks + 2 Wood -> Wood Spear",
    cost: [
      { slotId: "planks", count: 1 },
      { slotId: "wood", count: 2 }
    ],
    result: { slotId: "wood_spear", count: 1 }
  },
  {
    id: "stone_spear",
    label: "1 Cobble + 2 Wood -> Stone Spear",
    cost: [
      { slotId: "cobble", count: 1 },
      { slotId: "wood", count: 2 }
    ],
    result: { slotId: "stone_spear", count: 1 }
  },
  {
    id: "sliver_spear",
    label: "1 Sliver Ore + 2 Wood -> Sliver Spear",
    cost: [
      { slotId: "sliver_ore", count: 1 },
      { slotId: "wood", count: 2 }
    ],
    result: { slotId: "sliver_spear", count: 1 }
  },
  {
    id: "ruby_spear",
    label: "1 Ruby Ore + 2 Wood -> Ruby Spear",
    cost: [
      { slotId: "ruby_ore", count: 1 },
      { slotId: "wood", count: 2 }
    ],
    result: { slotId: "ruby_spear", count: 1 }
  },
  {
    id: "sapphire_spear",
    label: "1 Sapphire Ore + 2 Wood -> Sapphire Spear",
    cost: [
      { slotId: "sapphire_ore", count: 1 },
      { slotId: "wood", count: 2 }
    ],
    result: { slotId: "sapphire_spear", count: 1 }
  },
  {
    id: "gold_spear",
    label: "1 Gold Ore + 2 Wood -> Gold Spear",
    cost: [
      { slotId: "gold_ore", count: 1 },
      { slotId: "wood", count: 2 }
    ],
    result: { slotId: "gold_spear", count: 1 }
  },
  {
    id: "diamond_spear",
    label: "1 Diamond Ore + 2 Wood -> Diamond Spear",
    cost: [
      { slotId: "diamond_ore", count: 1 },
      { slotId: "wood", count: 2 }
    ],
    result: { slotId: "diamond_spear", count: 1 }
  },
  {
    id: "bow",
    label: "3 Wood + 3 String -> Bow",
    cost: [
      { slotId: "wood", count: 3 },
      { slotId: "string", count: 3 }
    ],
    result: { slotId: "bow", count: 1 }
  },
  {
    id: "fishing_rod",
    label: "3 Wood + 2 String -> Fishing Rod",
    cost: [
      { slotId: "wood", count: 3 },
      { slotId: "string", count: 2 }
    ],
    result: { slotId: "fishing_rod", count: 1 }
  },
  {
    id: "arrow",
    label: "1 Stone + 1 Wood + 1 Feather -> 4 Arrows",
    cost: [
      { slotId: "stone", count: 1 },
      { slotId: "wood", count: 1 },
      { slotId: "feather", count: 1 }
    ],
    result: { slotId: "arrow", count: 4 }
  },
  {
    id: "boss_summoner",
    label: "1 Diamond Ore + 2 Bone + 2 Gold Ore -> Cursed Totem",
    cost: [
      { slotId: "diamond_ore", count: 1 },
      { slotId: "bone", count: 2 },
      { slotId: "gold_ore", count: 2 }
    ],
    result: { slotId: "boss_summoner", count: 1 }
  },
  {
    id: "dragon_sword",
    label: "1 Dragon Heart + 2 Diamond Ore -> Dragon Sword",
    cost: [
      { slotId: "dragon_heart", count: 1 },
      { slotId: "diamond_ore", count: 2 }
    ],
    result: { slotId: "dragon_sword", count: 1 }
  },
  {
    id: "helmet",
    label: "4 Sapphire Ore + 1 Ruby Ore -> Helmet",
    cost: [
      { slotId: "sapphire_ore", count: 4 },
      { slotId: "ruby_ore", count: 1 }
    ],
    result: { slotId: "helmet", count: 1 }
  },
  {
    id: "face_mask",
    label: "2 Ruby Ore + 2 Sapphire Ore -> Face Mask",
    cost: [
      { slotId: "ruby_ore", count: 2 },
      { slotId: "sapphire_ore", count: 2 }
    ],
    result: { slotId: "face_mask", count: 1 }
  },
  {
    id: "neck_protection",
    label: "2 Gold Ore + 1 Sapphire Ore -> Neck Protection",
    cost: [
      { slotId: "gold_ore", count: 2 },
      { slotId: "sapphire_ore", count: 1 }
    ],
    result: { slotId: "neck_protection", count: 1 }
  },
  {
    id: "chestplate",
    label: "5 Gold Ore + 2 Sapphire Ore -> Chestplate",
    cost: [
      { slotId: "gold_ore", count: 5 },
      { slotId: "sapphire_ore", count: 2 }
    ],
    result: { slotId: "chestplate", count: 1 }
  },
  {
    id: "leggings",
    label: "4 Gold Ore + 2 Ruby Ore -> Leggings",
    cost: [
      { slotId: "gold_ore", count: 4 },
      { slotId: "ruby_ore", count: 2 }
    ],
    result: { slotId: "leggings", count: 1 }
  },
  {
    id: "boots",
    label: "2 Sapphire Ore + 2 Gold Ore -> Boots",
    cost: [
      { slotId: "sapphire_ore", count: 2 },
      { slotId: "gold_ore", count: 2 }
    ],
    result: { slotId: "boots", count: 1 }
  }
];

// Villager trades are station-gated recipes, so they share the recipe book + the
// `craft` command. They live in their own module (the trade analog of recipes).
export const RECIPES: Recipe[] = [...CRAFTING_RECIPES, ...TRADES];

// --- Recipe categories (recipe-book grouping) ---

/**
 * The section a recipe falls under in the recipe book. Station recipes get their
 * own group (a furnace smelts, a villager trades); everything else is grouped by
 * the kind of item it produces.
 */
export type RecipeCategory = "Tools" | "Weapons" | "Armor" | "Building" | "Food" | "Materials" | "Smelting" | "Brewing" | "Trades";

/** Fixed display order; `groupRecipes` emits sections in this sequence. */
export const RECIPE_CATEGORY_ORDER: RecipeCategory[] = ["Tools", "Weapons", "Armor", "Building", "Food", "Materials", "Smelting", "Brewing", "Trades"];

const KIND_TO_CATEGORY: Record<ItemKind, RecipeCategory> = {
  tool: "Tools",
  weapon: "Weapons",
  armor: "Armor",
  block: "Building",
  food: "Food",
  material: "Materials"
};

/**
 * The recipe book section for a recipe. Station recipes take precedence so
 * smelting and trades stay together; otherwise the category is derived from the
 * result item's `kind` (falling back to "Materials" for an unknown result).
 */
export function recipeCategory(recipe: Recipe): RecipeCategory {
  if (recipe.station === "villager") return "Trades";
  if (recipe.station === "furnace") return "Smelting";
  if (recipe.station === "brewing") return "Brewing";
  const kind = ITEM_DEF_BY_ID[recipe.result.slotId]?.kind;
  return kind ? KIND_TO_CATEGORY[kind] : "Materials";
}

export type RecipeGroup = { category: RecipeCategory; recipes: Recipe[] };

/**
 * Buckets recipes into the fixed category order, dropping empty categories.
 * Within each group, recipes the player can make right now (`canMakeNow`) are
 * listed first; both partitions preserve the original source order.
 */
export function groupRecipes(recipes: Recipe[], canMakeNow: (recipe: Recipe) => boolean): RecipeGroup[] {
  const buckets = new Map<RecipeCategory, Recipe[]>();
  for (const recipe of recipes) {
    const category = recipeCategory(recipe);
    const bucket = buckets.get(category);
    if (bucket) bucket.push(recipe);
    else buckets.set(category, [recipe]);
  }

  const groups: RecipeGroup[] = [];
  for (const category of RECIPE_CATEGORY_ORDER) {
    const bucket = buckets.get(category);
    if (!bucket) continue;
    const ready: Recipe[] = [];
    const rest: Recipe[] = [];
    for (const recipe of bucket) (canMakeNow(recipe) ? ready : rest).push(recipe);
    groups.push({ category, recipes: [...ready, ...rest] });
  }
  return groups;
}
