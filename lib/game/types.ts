import * as THREE from "three";
import { BlockId, type WorldType } from "@/lib/world";
import type { GameMode } from "./gameModes";
import type { Difficulty } from "./difficulties";

export type ItemKind = "block" | "weapon" | "tool" | "armor" | "food" | "material";
export type ArmorSlot = "helmet" | "face_mask" | "neck_protection" | "chestplate" | "leggings" | "boots";
/** The worn armor pieces, one per slot — the actual item instance (or null). Equipping moves the piece here, out of the inventory. */
export type EquippedArmor = Record<ArmorSlot, InventorySlot | null>;

/** A timed status effect on the player. Positive effects come from potions; poison is a hazard. */
export type EffectId = "speed" | "strength" | "regeneration" | "fire_resistance" | "water_breathing" | "poison";

/** The effect a drinkable potion applies, with how long it lasts. */
export type ItemEffect = { id: EffectId; durationSeconds: number };

/** A gear enchantment applied at the enchanting table; each maps to one combat/mining/durability seam. */
export type EnchantmentId = "sharpness" | "protection" | "efficiency" | "unbreaking" | "mending" | "power" | "punch";

/** A per-item-instance enchantment and its level. */
export type Enchantment = { id: EnchantmentId; level: number };

export type ItemDef = {
  id: string;
  label: string;
  kind: ItemKind;
  blockId?: BlockId;
  attack?: number;
  meleeReach?: number;
  throwDamage?: number;
  minePower?: number;
  mineTier?: number;
  armorSlot?: ArmorSlot;
  defense?: number;
  maxDurability?: number;
  /** Hunger points restored when eaten (food items only). */
  hunger?: number;
  /** The status effect this potion applies when drunk (potion items only). */
  effect?: ItemEffect;
};

export type InventorySlot = {
  id: string | null;
  label: string;
  kind: ItemKind | null;
  count: number;
  blockId?: BlockId;
  attack?: number;
  meleeReach?: number;
  throwDamage?: number;
  minePower?: number;
  mineTier?: number;
  armorSlot?: ArmorSlot;
  defense?: number;
  durability?: number;
  maxDurability?: number;
  hunger?: number;
  effect?: ItemEffect;
  /** Per-instance enchantments (durable gear only) — applied at the enchanting table. */
  enchantments?: Enchantment[];
  /** Player-set name from the anvil (durable gear only); falls back to `label` for display. */
  customName?: string;
};

export type Recipe = {
  id: string;
  label: string;
  cost: Array<{ slotId: string; count: number }>;
  result: { slotId: string; count: number };
  /**
   * Station required for this recipe; omitted means the basic crafting grid.
   * "furnace" smelts; "villager" is a trade offer, unlocked while trading with a
   * villager; "brewing" is a potion recipe, unlocked at a brewing stand.
   */
  station?: "furnace" | "villager" | "brewing";
};

export type MobKind = "sheep" | "chicken" | "horse" | "cow" | "pig" | "zombie" | "skeleton" | "spider" | "creeper" | "villager" | "boss";

export type MobModel = {
  group: THREE.Group;
  legs: THREE.Mesh[];
  halfHeight: number;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
};

/** A persisted inventory/container slot: just enough to rebuild it on load. */
export type SavedSlot = { id: string | null; count: number; durability?: number; enchantments?: Enchantment[]; customName?: string };

/** Legacy persisted armor (v1–v11): a by-id reference into the inventory. */
export type SavedArmorById = Partial<Record<ArmorSlot, string | null>>;
/** Persisted armor (v12+): the worn piece itself, stored per slot via the shared SavedSlot shape. */
export type SavedEquippedArmor = Partial<Record<ArmorSlot, SavedSlot>>;

/** A block-entity: a placed chest's contents, keyed by its voxel index. */
export type SavedContainer = { index: number; slots: SavedSlot[] };

/** Legacy save shape (40 inventory slots, 10-slot hotbar) — accepted and migrated on load. */
export type SaveDataV1 = {
  version: 1;
  seed: number;
  changes: Array<[number, number]>;
  inventoryCounts?: Record<string, number>;
  inventorySlots?: SavedSlot[];
  equippedArmor?: SavedArmorById;
  selectedSlot: number;
  player: { x: number; y: number; z: number };
};

/** v2 save shape: same fields as v1, reinterpreted for 36 slots / 9-slot hotbar. */
export type SaveDataV2 = Omit<SaveDataV1, "version"> & { version: 2 };

/**
 * v3 save shape: v2 plus persisted time-of-day, player stats, and the bed
 * respawn point. All added fields are optional so the v2→v3 migration is a pure
 * version bump and pre-v3 saves load with sensible defaults.
 */
export type SaveDataV3 = Omit<SaveDataV2, "version"> & {
  version: 3;
  dayClock?: number;
  hearts?: number;
  hunger?: number;
  spawnPoint?: { x: number; y: number; z: number } | null;
};

/**
 * v4 save shape: v3 plus chest contents as block-entities. The field is
 * optional so the v3→v4 migration is a pure version bump and pre-v4 saves load
 * with no containers.
 */
export type SaveDataV4 = Omit<SaveDataV3, "version"> & {
  version: 4;
  blockEntities?: SavedContainer[];
};

/**
 * v5 save shape: v4 plus the set of dungeon loot-chest voxel indices the player
 * has already opened or broken. Dungeon chests are filled lazily on first access
 * and this set — not the chest's emptiness — is what prevents a re-roll on reload
 * (an emptied chest is dropped from `blockEntities`). The field is optional so
 * the v4→v5 migration is a pure version bump.
 */
export type SaveDataV5 = Omit<SaveDataV4, "version"> & {
  version: 5;
  lootedChests?: number[];
  /** Generation preset; absent ⇒ "default" (pre-feature and legacy saves). Like `seed`, fixed for the world's life. */
  worldType?: WorldType;
};

/** One persisted status effect: its id and the seconds remaining when saved. */
export type SavedEffect = { id: EffectId; remaining: number };

/**
 * v6 save shape: v5 plus the active status effects (with their remaining
 * seconds). The field is optional so the v5→v6 migration is a pure version bump
 * and pre-effect saves load with none. Effects are cleared on death, so a
 * saved-then-reloaded world restores whatever was active at save.
 */
export type SaveDataV6 = Omit<SaveDataV5, "version"> & {
  version: 6;
  effects?: SavedEffect[];
};

/**
 * v7 save shape: v6 plus banked XP (`xp`). Enchantments ride inside each
 * `SavedSlot` (additive). Both are optional, so the v6→v7 migration is a pure
 * version bump and pre-XP saves load with `xp` 0 and no enchantments. Unlike
 * effects, XP is a long-term currency and is NOT cleared on death.
 */
export type SaveDataV7 = Omit<SaveDataV6, "version"> & {
  version: 7;
  xp?: number;
};

/**
 * v8 save shape: v7 plus the player's game mode (`gameMode`). The field is
 * optional, so the v7→v8 migration is a pure version bump and pre-mode saves
 * load as "survival". Unlike `worldType` (fixed for the world's life),
 * `gameMode` is switchable in-game, so the saved value is the *current* mode.
 */
export type SaveDataV8 = Omit<SaveDataV7, "version"> & {
  version: 8;
  gameMode?: GameMode;
};

/**
 * v9 save shape: v8 plus the player's difficulty (`difficulty`). The field is
 * optional, so the v8→v9 migration is a pure version bump and pre-v9 saves load
 * as "normal". Like `gameMode`, difficulty is switchable in-game, so the saved
 * value is the *current* difficulty.
 */
export type SaveDataV9 = Omit<SaveDataV8, "version"> & {
  version: 9;
  difficulty?: Difficulty;
};

/**
 * v10 save shape: v9 plus the Hardcore flag (`hardcore`, immutable for the
 * world's life) and the permadeath `gameOver` flag (set once a hardcore run has
 * ended). Both are optional, so the v9→v10 migration is a pure version bump and
 * pre-v10 saves load as a normal, non-hardcore world. A persisted `gameOver`
 * reloads straight into the spectator "dead world" state, never a playable one.
 */
export type SaveDataV10 = Omit<SaveDataV9, "version"> & {
  version: 10;
  hardcore?: boolean;
  gameOver?: boolean;
};

/**
 * v11 save shape: v10 plus a per-item `customName` (the anvil rename), which rides
 * inside each `SavedSlot` (additive). The Mending enchantment rides the existing
 * per-slot `enchantments`, so it adds no new field. The v10→v11 migration is a
 * pure version bump and pre-v11 saves load with no custom names.
 */
export type SaveDataV11 = Omit<SaveDataV10, "version"> & {
  version: 11;
};

/**
 * Current save shape (v12): armor moves to dedicated storage. `equippedArmor` is no
 * longer a by-id reference into the inventory (`SavedArmorById`) but the worn pieces
 * themselves (`SavedEquippedArmor`, per-slot `SavedSlot`). The v11→v12 migration
 * moves each legacy by-id equip out of `inventorySlots` into the armor record so a
 * worn piece no longer double-occupies an inventory slot.
 */
export type SaveData = Omit<SaveDataV11, "version" | "equippedArmor"> & {
  version: 12;
  equippedArmor?: SavedEquippedArmor;
};
