import { BlockId } from "@/lib/world";
import type { ArmorSlot, EquippedArmor, InventorySlot, ItemDef, Recipe } from "@/lib/game/types";

export const PLAYER_HEIGHT = 1.8;
export const PLAYER_HALF_WIDTH = 0.3;
export const EYE_HEIGHT = 1.62;
export const GRAVITY = 26;
export const JUMP_VELOCITY = 8.2;
export const WALK_SPEED = 4.8;
export const SPRINT_SPEED = 12.8;
export const CROUCH_SPEED = 2.1;
export const MAX_HEARTS = 50;
export const MAX_ENERGY = 100;
export const HOTBAR_SLOTS = 10;
export const INVENTORY_SLOTS = 40;
export const MAX_STACK_SIZE = 99;
export const RENDER_RADIUS = 90;
export const RENDER_GRID = 20;

export const SAVE_KEY = "minecraft_save_v4";
export const ARMOR_SLOTS: ArmorSlot[] = ["helmet", "face_mask", "neck_protection", "chestplate", "leggings", "boots"];
export const ARMOR_SLOT_LABELS: Record<ArmorSlot, string> = {
  helmet: "Helmet",
  face_mask: "Face Mask",
  neck_protection: "Neck Protection",
  chestplate: "Chestplate",
  leggings: "Leggings",
  boots: "Boots"
};

export function createEmptyArmorEquipment(): EquippedArmor {
  return {
    helmet: null,
    face_mask: null,
    neck_protection: null,
    chestplate: null,
    leggings: null,
    boots: null
  };
}

export const BREAK_HARDNESS: Partial<Record<BlockId, number>> = {
  [BlockId.Grass]: 2,
  [BlockId.Dirt]: 2,
  [BlockId.Sand]: 2,
  [BlockId.Leaves]: 2,
  [BlockId.Wood]: 3,
  [BlockId.Planks]: 3,
  [BlockId.Stone]: 5,
  [BlockId.Cobblestone]: 5,
  [BlockId.Brick]: 5,
  [BlockId.Glass]: 2,
  [BlockId.SliverOre]: 7,
  [BlockId.RubyOre]: 9,
  [BlockId.GoldOre]: 11,
  [BlockId.SapphireOre]: 12,
  [BlockId.DiamondOre]: 14
};

export const ITEM_DEFS: ItemDef[] = [
  { id: "grass", label: "Grass", kind: "block", blockId: BlockId.Grass },
  { id: "dirt", label: "Dirt", kind: "block", blockId: BlockId.Dirt },
  { id: "stone", label: "Stone", kind: "block", blockId: BlockId.Stone },
  { id: "wood", label: "Wood", kind: "block", blockId: BlockId.Wood },
  { id: "planks", label: "Planks", kind: "block", blockId: BlockId.Planks },
  { id: "cobble", label: "Cobble", kind: "block", blockId: BlockId.Cobblestone },
  { id: "sand", label: "Sand", kind: "block", blockId: BlockId.Sand },
  { id: "brick", label: "Brick", kind: "block", blockId: BlockId.Brick },
  { id: "glass", label: "Glass", kind: "block", blockId: BlockId.Glass },
  { id: "sliver_ore", label: "Sliver Ore", kind: "block", blockId: BlockId.SliverOre },
  { id: "ruby_ore", label: "Ruby Ore", kind: "block", blockId: BlockId.RubyOre },
  { id: "gold_ore", label: "Gold Ore", kind: "block", blockId: BlockId.GoldOre },
  { id: "sapphire_ore", label: "Sapphire Ore", kind: "block", blockId: BlockId.SapphireOre },
  { id: "diamond_ore", label: "Diamond Ore", kind: "block", blockId: BlockId.DiamondOre },
  { id: "wood_pickaxe", label: "Wood Pickaxe", kind: "tool", minePower: 1.05, mineTier: 1 },
  { id: "stone_pickaxe", label: "Stone Pickaxe", kind: "tool", minePower: 1.55, mineTier: 2 },
  { id: "sliver_pickaxe", label: "Sliver Pickaxe", kind: "tool", minePower: 2.2, mineTier: 3 },
  { id: "ruby_pickaxe", label: "Ruby Pickaxe", kind: "tool", minePower: 2.8, mineTier: 4 },
  { id: "sapphire_pickaxe", label: "Sapphire Pickaxe", kind: "tool", minePower: 3.3, mineTier: 5 },
  { id: "gold_pickaxe", label: "Gold Pickaxe", kind: "tool", minePower: 3.8, mineTier: 6 },
  { id: "diamond_pickaxe", label: "Diamond Pickaxe", kind: "tool", minePower: 4.4, mineTier: 7 },
  { id: "food", label: "Food", kind: "block" },
  { id: "knife", label: "Knife", kind: "weapon", attack: 9 },
  { id: "wood_sword", label: "Wood Sword", kind: "weapon", attack: 13 },
  { id: "stone_sword", label: "Stone Sword", kind: "weapon", attack: 18 },
  { id: "sliver_sword", label: "Sliver Sword", kind: "weapon", attack: 24 },
  { id: "ruby_sword", label: "Ruby Sword", kind: "weapon", attack: 31 },
  { id: "sapphire_sword", label: "Sapphire Sword", kind: "weapon", attack: 35 },
  { id: "gold_sword", label: "Gold Sword", kind: "weapon", attack: 40 },
  { id: "diamond_sword", label: "Diamond Sword", kind: "weapon", attack: 47 },
  { id: "helmet", label: "Helmet", kind: "armor", armorSlot: "helmet", defense: 2 },
  { id: "face_mask", label: "Face Mask", kind: "armor", armorSlot: "face_mask", defense: 2 },
  { id: "neck_protection", label: "Neck Protection", kind: "armor", armorSlot: "neck_protection", defense: 2 },
  { id: "chestplate", label: "Chestplate", kind: "armor", armorSlot: "chestplate", defense: 4 },
  { id: "leggings", label: "Leggings", kind: "armor", armorSlot: "leggings", defense: 3 },
  { id: "boots", label: "Boots", kind: "armor", armorSlot: "boots", defense: 2 }
];

export const ITEM_DEF_BY_ID: Record<string, ItemDef> = Object.fromEntries(ITEM_DEFS.map((item) => [item.id, item]));

export function createEmptySlot(): InventorySlot {
  return { id: null, label: "Empty", kind: null, count: 0 };
}

export function createSlot(itemId: string, count: number): InventorySlot {
  const def = ITEM_DEF_BY_ID[itemId];
  if (!def) return createEmptySlot();
  return { ...def, count };
}

export function createInitialInventory(): InventorySlot[] {
  const slots: InventorySlot[] = Array.from({ length: INVENTORY_SLOTS }, () => createEmptySlot());
  const starter: Array<{ id: string; count: number }> = [
    { id: "grass", count: 64 },
    { id: "dirt", count: 64 },
    { id: "stone", count: 64 },
    { id: "wood", count: 64 },
    { id: "planks", count: 20 },
    { id: "cobble", count: 20 },
    { id: "sand", count: 20 },
    { id: "wood_pickaxe", count: 1 },
    { id: "knife", count: 1 }
  ];
  for (let i = 0; i < starter.length && i < slots.length; i += 1) slots[i] = createSlot(starter[i].id, starter[i].count);
  return slots;
}

export const BLOCK_TO_SLOT: Partial<Record<BlockId, string>> = {
  [BlockId.Grass]: "grass",
  [BlockId.Dirt]: "dirt",
  [BlockId.Stone]: "stone",
  [BlockId.Wood]: "wood",
  [BlockId.Leaves]: "dirt",
  [BlockId.Planks]: "planks",
  [BlockId.Cobblestone]: "cobble",
  [BlockId.Sand]: "sand",
  [BlockId.Brick]: "brick",
  [BlockId.Glass]: "glass",
  [BlockId.SliverOre]: "sliver_ore",
  [BlockId.RubyOre]: "ruby_ore",
  [BlockId.GoldOre]: "gold_ore",
  [BlockId.SapphireOre]: "sapphire_ore",
  [BlockId.DiamondOre]: "diamond_ore"
};

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
