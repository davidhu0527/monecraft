import { DOOR_BLOCK_IDS, BlockId, isDoorBlock } from "@/lib/world";
import { GRASS_SEED_DROP_CHANCE, INVENTORY_SLOTS, MAX_STACK_SIZE, SPEAR_MELEE_REACH } from "@/lib/game/config";
import type { ArmorSlot, EquippedArmor, InventorySlot, ItemDef } from "@/lib/game/types";

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
  ...Object.fromEntries(DOOR_BLOCK_IDS.map((block) => [block, 3])),
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
  [BlockId.DiamondOre]: 14,
  [BlockId.Snow]: 2,
  [BlockId.Cactus]: 2,
  [BlockId.Bed]: 2,
  [BlockId.Farmland]: 1,
  [BlockId.WheatStage0]: 1,
  [BlockId.WheatStage1]: 1,
  [BlockId.WheatStage2]: 1,
  [BlockId.WheatStage3]: 1,
  [BlockId.Furnace]: 5,
  [BlockId.Chest]: 3,
  [BlockId.MossyCobblestone]: 5,
  // A spawner is hard to break and drops nothing (no BLOCK_TO_SLOT entry).
  [BlockId.Spawner]: 30
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
  { id: "snow", label: "Snow", kind: "block", blockId: BlockId.Snow },
  { id: "cactus", label: "Cactus", kind: "block", blockId: BlockId.Cactus },
  { id: "bed", label: "Bed", kind: "block", blockId: BlockId.Bed },
  { id: "furnace", label: "Furnace", kind: "block", blockId: BlockId.Furnace },
  { id: "chest", label: "Chest", kind: "block", blockId: BlockId.Chest },
  { id: "mossy_cobble", label: "Mossy Cobble", kind: "block", blockId: BlockId.MossyCobblestone },
  { id: "door", label: "Wood Door", kind: "block", blockId: BlockId.DoorNorthLower },
  { id: "wood_pickaxe", label: "Wood Pickaxe", kind: "tool", minePower: 1.05, mineTier: 1, maxDurability: 70 },
  { id: "stone_pickaxe", label: "Stone Pickaxe", kind: "tool", minePower: 1.55, mineTier: 2, maxDurability: 140 },
  { id: "sliver_pickaxe", label: "Sliver Pickaxe", kind: "tool", minePower: 2.2, mineTier: 3, maxDurability: 240 },
  { id: "ruby_pickaxe", label: "Ruby Pickaxe", kind: "tool", minePower: 2.8, mineTier: 4, maxDurability: 340 },
  { id: "sapphire_pickaxe", label: "Sapphire Pickaxe", kind: "tool", minePower: 3.3, mineTier: 5, maxDurability: 430 },
  { id: "gold_pickaxe", label: "Gold Pickaxe", kind: "tool", minePower: 3.8, mineTier: 6, maxDurability: 520 },
  { id: "diamond_pickaxe", label: "Diamond Pickaxe", kind: "tool", minePower: 4.4, mineTier: 7, maxDurability: 700 },
  { id: "food", label: "Food", kind: "food", hunger: 7 },
  // Mob materials — craft ingredients with no direct use on their own yet.
  { id: "wool", label: "Wool", kind: "material" },
  { id: "feather", label: "Feather", kind: "material" },
  { id: "bone", label: "Bone", kind: "material" },
  { id: "leather", label: "Leather", kind: "material" },
  { id: "string", label: "String", kind: "material" },
  // Mob meats — edible raw; rotten flesh fills little, fresh meat more.
  { id: "rotten_flesh", label: "Rotten Flesh", kind: "food", hunger: 2 },
  { id: "raw_chicken", label: "Raw Chicken", kind: "food", hunger: 3 },
  { id: "raw_mutton", label: "Raw Mutton", kind: "food", hunger: 3 },
  // Farming
  { id: "wood_hoe", label: "Wood Hoe", kind: "tool", minePower: 1.0, mineTier: 0, maxDurability: 90 },
  { id: "seeds", label: "Wheat Seeds", kind: "material" },
  { id: "wheat", label: "Wheat", kind: "material" },
  { id: "bread", label: "Bread", kind: "food", hunger: 6 },
  // Cooked meats — smelted in a furnace; restore more than their raw form.
  { id: "cooked_chicken", label: "Cooked Chicken", kind: "food", hunger: 8 },
  { id: "cooked_mutton", label: "Cooked Mutton", kind: "food", hunger: 8 },
  { id: "knife", label: "Knife", kind: "weapon", attack: 9, maxDurability: 50 },
  { id: "wood_sword", label: "Wood Sword", kind: "weapon", attack: 13, maxDurability: 80 },
  { id: "stone_sword", label: "Stone Sword", kind: "weapon", attack: 18, maxDurability: 160 },
  { id: "sliver_sword", label: "Sliver Sword", kind: "weapon", attack: 24, maxDurability: 260 },
  { id: "ruby_sword", label: "Ruby Sword", kind: "weapon", attack: 31, maxDurability: 360 },
  { id: "sapphire_sword", label: "Sapphire Sword", kind: "weapon", attack: 35, maxDurability: 450 },
  { id: "gold_sword", label: "Gold Sword", kind: "weapon", attack: 40, maxDurability: 540 },
  { id: "diamond_sword", label: "Diamond Sword", kind: "weapon", attack: 47, maxDurability: 720 },
  {
    id: "wood_spear",
    label: "Wood Spear",
    kind: "weapon",
    attack: 11,
    meleeReach: SPEAR_MELEE_REACH,
    throwDamage: 15,
    maxDurability: 70
  },
  {
    id: "stone_spear",
    label: "Stone Spear",
    kind: "weapon",
    attack: 16,
    meleeReach: SPEAR_MELEE_REACH,
    throwDamage: 21,
    maxDurability: 140
  },
  {
    id: "sliver_spear",
    label: "Sliver Spear",
    kind: "weapon",
    attack: 22,
    meleeReach: SPEAR_MELEE_REACH,
    throwDamage: 28,
    maxDurability: 230
  },
  {
    id: "ruby_spear",
    label: "Ruby Spear",
    kind: "weapon",
    attack: 29,
    meleeReach: SPEAR_MELEE_REACH,
    throwDamage: 36,
    maxDurability: 330
  },
  {
    id: "sapphire_spear",
    label: "Sapphire Spear",
    kind: "weapon",
    attack: 33,
    meleeReach: SPEAR_MELEE_REACH,
    throwDamage: 41,
    maxDurability: 420
  },
  {
    id: "gold_spear",
    label: "Gold Spear",
    kind: "weapon",
    attack: 38,
    meleeReach: SPEAR_MELEE_REACH,
    throwDamage: 47,
    maxDurability: 500
  },
  {
    id: "diamond_spear",
    label: "Diamond Spear",
    kind: "weapon",
    attack: 45,
    meleeReach: SPEAR_MELEE_REACH,
    throwDamage: 55,
    maxDurability: 680
  },
  // Bow fires arrows; it never melees (attack 0), so the attack input branches
  // to firing when a bow is held. Arrows are the consumable ammo.
  { id: "bow", label: "Bow", kind: "weapon", attack: 0, maxDurability: 200 },
  { id: "arrow", label: "Arrow", kind: "material" },
  // Endgame: a diamond-gated totem summons the boss; its Dragon Heart drop
  // crafts the best-in-game Dragon Sword.
  { id: "boss_summoner", label: "Cursed Totem", kind: "material" },
  { id: "dragon_heart", label: "Dragon Heart", kind: "material" },
  { id: "dragon_sword", label: "Dragon Sword", kind: "weapon", attack: 60, maxDurability: 1200 },
  { id: "helmet", label: "Helmet", kind: "armor", armorSlot: "helmet", defense: 2, maxDurability: 260 },
  { id: "face_mask", label: "Face Mask", kind: "armor", armorSlot: "face_mask", defense: 2, maxDurability: 220 },
  { id: "neck_protection", label: "Neck Protection", kind: "armor", armorSlot: "neck_protection", defense: 2, maxDurability: 230 },
  { id: "chestplate", label: "Chestplate", kind: "armor", armorSlot: "chestplate", defense: 4, maxDurability: 420 },
  { id: "leggings", label: "Leggings", kind: "armor", armorSlot: "leggings", defense: 3, maxDurability: 340 },
  { id: "boots", label: "Boots", kind: "armor", armorSlot: "boots", defense: 2, maxDurability: 250 }
];

export const ITEM_DEF_BY_ID: Record<string, ItemDef> = Object.fromEntries(ITEM_DEFS.map((item) => [item.id, item]));

export function maxStackSizeForItem(itemId: string): number {
  return ITEM_DEF_BY_ID[itemId]?.maxDurability ? 1 : MAX_STACK_SIZE;
}

export function createEmptySlot(): InventorySlot {
  return { id: null, label: "Empty", kind: null, count: 0 };
}

export function createSlot(itemId: string, count: number): InventorySlot {
  const def = ITEM_DEF_BY_ID[itemId];
  if (!def) return createEmptySlot();
  const slot: InventorySlot = { ...def, count: Math.min(maxStackSizeForItem(itemId), Math.max(0, Math.floor(count))) };
  if ((def.kind === "tool" || def.kind === "weapon" || def.kind === "armor") && def.maxDurability) {
    slot.maxDurability = def.maxDurability;
    slot.durability = def.maxDurability;
  }
  return slot;
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
  [BlockId.DiamondOre]: "diamond_ore",
  [BlockId.Snow]: "snow",
  [BlockId.Cactus]: "cactus",
  [BlockId.Bed]: "bed",
  [BlockId.Furnace]: "furnace",
  [BlockId.Chest]: "chest",
  [BlockId.MossyCobblestone]: "mossy_cobble",
  [BlockId.DoorNorthLower]: "door",
  // Tilled soil reverts to dirt; immature wheat returns its seed.
  [BlockId.Farmland]: "dirt",
  [BlockId.WheatStage0]: "seeds",
  [BlockId.WheatStage1]: "seeds",
  [BlockId.WheatStage2]: "seeds"
};

/**
 * Items a broken block yields. The default is its single `BLOCK_TO_SLOT` entry;
 * grass occasionally also drops a seed (the natural seed source), and mature
 * wheat drops wheat plus 1–2 seeds. `rng` is injectable for deterministic tests.
 */
export function rollBlockDrops(block: BlockId, rng: () => number): Array<{ itemId: string; count: number }> {
  if (isDoorBlock(block)) return [{ itemId: "door", count: 1 }];
  const drops: Array<{ itemId: string; count: number }> = [];
  const base = BLOCK_TO_SLOT[block];
  if (base) drops.push({ itemId: base, count: 1 });

  if (block === BlockId.Grass && rng() < GRASS_SEED_DROP_CHANCE) {
    drops.push({ itemId: "seeds", count: 1 });
  }
  if (block === BlockId.WheatStage3) {
    drops.push({ itemId: "wheat", count: 1 });
    drops.push({ itemId: "seeds", count: 1 + Math.floor(rng() * 2) });
  }
  return drops;
}
