import type { Recipe } from "@/lib/game/types";

export const RECIPES: Recipe[] = [
  { id: "planks", label: "2 Wood -> 4 Planks", cost: [{ slotId: "wood", count: 2 }], result: { slotId: "planks", count: 4 } },
  { id: "glass", label: "4 Sand -> 2 Glass", cost: [{ slotId: "sand", count: 4 }], result: { slotId: "glass", count: 2 } },
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
