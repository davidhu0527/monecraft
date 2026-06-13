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
};

export type MobKind = "sheep" | "chicken" | "horse" | "zombie" | "skeleton" | "spider";

export type MobModel = {
  group: THREE.Group;
  legs: THREE.Mesh[];
  halfHeight: number;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
};

/** Legacy save shape (40 inventory slots, 10-slot hotbar) — accepted and migrated on load. */
export type SaveDataV1 = {
  version: 1;
  seed: number;
  changes: Array<[number, number]>;
  inventoryCounts?: Record<string, number>;
  inventorySlots?: Array<{ id: string | null; count: number; durability?: number }>;
  equippedArmor?: Partial<EquippedArmor>;
  selectedSlot: number;
  player: { x: number; y: number; z: number };
};

/** v2 save shape: same fields as v1, reinterpreted for 36 slots / 9-slot hotbar. */
export type SaveDataV2 = Omit<SaveDataV1, "version"> & { version: 2 };

/**
 * Current save shape (v3): v2 plus persisted time-of-day, player stats, and the
 * bed respawn point. All new fields are optional so the v2→v3 migration is a
 * pure version bump and pre-v3 saves load with sensible defaults.
 */
export type SaveData = Omit<SaveDataV2, "version"> & {
  version: 3;
  dayClock?: number;
  hearts?: number;
  hunger?: number;
  spawnPoint?: { x: number; y: number; z: number } | null;
};
