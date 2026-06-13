import * as THREE from "three";
import { BlockId } from "@/lib/world";

export type ItemKind = "block" | "weapon" | "tool" | "armor" | "food" | "material";
export type ArmorSlot = "helmet" | "face_mask" | "neck_protection" | "chestplate" | "leggings" | "boots";
export type EquippedArmor = Record<ArmorSlot, string | null>;

export type ItemDef = {
  id: string;
  label: string;
  kind: ItemKind;
  blockId?: BlockId;
  attack?: number;
  minePower?: number;
  mineTier?: number;
  armorSlot?: ArmorSlot;
  defense?: number;
  maxDurability?: number;
  /** Hunger points restored when eaten (food items only). */
  hunger?: number;
};

export type InventorySlot = {
  id: string | null;
  label: string;
  kind: ItemKind | null;
  count: number;
  blockId?: BlockId;
  attack?: number;
  minePower?: number;
  mineTier?: number;
  armorSlot?: ArmorSlot;
  defense?: number;
  durability?: number;
  maxDurability?: number;
  hunger?: number;
};

export type Recipe = {
  id: string;
  label: string;
  cost: Array<{ slotId: string; count: number }>;
  result: { slotId: string; count: number };
  /** Crafting station required; omitted means the basic crafting grid. */
  station?: "furnace";
};

export type MobKind = "sheep" | "chicken" | "horse" | "zombie" | "skeleton" | "spider";

export type MobModel = {
  group: THREE.Group;
  legs: THREE.Mesh[];
  halfHeight: number;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
};

/** A persisted inventory/container slot: just enough to rebuild it on load. */
export type SavedSlot = { id: string | null; count: number; durability?: number };

/** A block-entity: a placed chest's contents, keyed by its voxel index. */
export type SavedContainer = { index: number; slots: SavedSlot[] };

/** Legacy save shape (40 inventory slots, 10-slot hotbar) — accepted and migrated on load. */
export type SaveDataV1 = {
  version: 1;
  seed: number;
  changes: Array<[number, number]>;
  inventoryCounts?: Record<string, number>;
  inventorySlots?: SavedSlot[];
  equippedArmor?: Partial<EquippedArmor>;
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
 * Current save shape (v4): v3 plus chest contents as block-entities. The new
 * field is optional so the v3→v4 migration is a pure version bump and pre-v4
 * saves load with no containers. `SAVE_KEY` is unchanged — chests are never
 * generated, so worldgen and the block-diff index space are untouched.
 */
export type SaveData = Omit<SaveDataV3, "version"> & {
  version: 4;
  blockEntities?: SavedContainer[];
};
