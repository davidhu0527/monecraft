import * as THREE from "three";
import { BlockId } from "@/lib/world";

export type ItemKind = "block" | "weapon" | "tool" | "armor";
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
};

export type Recipe = {
  id: string;
  label: string;
  cost: Array<{ slotId: string; count: number }>;
  result: { slotId: string; count: number };
};

export type MobKind = "sheep" | "chicken" | "horse" | "zombie" | "skeleton" | "spider";

export type MobEntity = {
  kind: MobKind;
  hostile: boolean;
  hp: number;
  group: THREE.Group;
  legs: THREE.Mesh[];
  direction: THREE.Vector3;
  turnTimer: number;
  speed: number;
  detectRange: number;
  attackDamage: number;
  attackCooldown: number;
  attackTimer: number;
  halfHeight: number;
  bobSeed: number;
};

export type MobModel = {
  group: THREE.Group;
  legs: THREE.Mesh[];
  halfHeight: number;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
};

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
