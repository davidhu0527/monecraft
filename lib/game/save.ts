import { CHEST_SLOTS, HOTBAR_SLOTS, INVENTORY_SLOTS, MAX_HEARTS, MAX_HUNGER, MAX_STACK_SIZE } from "@/lib/game/config";
import { ARMOR_SLOTS, createEmptyArmorEquipment, createEmptySlot, createSlot, ITEM_DEF_BY_ID, maxStackSizeForItem } from "@/lib/game/items";
import type { EquippedArmor, SaveData, SaveDataV1, SaveDataV2, SaveDataV3, SavedContainer, SavedSlot, InventorySlot } from "@/lib/game/types";

/**
 * Migrates a v1 save (40 slots, 10-slot hotbar) to v2 (36 slots, 9-slot
 * hotbar): non-empty slots are packed in order, stackable items merge into
 * earlier stacks, and anything that still overflows 36 slots is dropped.
 */
/** Coerces a persisted hotbar index to a finite integer within 0..HOTBAR_SLOTS-1. */
function normalizeSelectedSlot(value: number): number {
  const index = Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.max(0, Math.min(HOTBAR_SLOTS - 1, index));
}

export function migrateSaveV1toV2(save: SaveDataV1): SaveDataV2 {
  const migrated: SaveDataV2 = { ...save, version: 2, selectedSlot: normalizeSelectedSlot(save.selectedSlot) };

  if (Array.isArray(save.inventorySlots)) {
    const packed: Array<{ id: string | null; count: number; durability?: number }> = [];
    for (const saved of save.inventorySlots) {
      if (!saved?.id || saved.count <= 0) continue;
      // Items without durability stack; merge them into an earlier stack first.
      const stackable = ITEM_DEF_BY_ID[saved.id] ? !ITEM_DEF_BY_ID[saved.id].maxDurability : false;
      let remaining = saved.count;
      if (stackable) {
        for (const slot of packed) {
          if (slot.id !== saved.id || slot.count >= MAX_STACK_SIZE) continue;
          const moved = Math.min(MAX_STACK_SIZE - slot.count, remaining);
          slot.count += moved;
          remaining -= moved;
          if (remaining === 0) break;
        }
      }
      while (remaining > 0 && packed.length < INVENTORY_SLOTS) {
        const moved = Math.min(maxStackSizeForItem(saved.id), remaining);
        packed.push({ id: saved.id, count: moved, durability: saved.durability });
        remaining -= moved;
      }
    }
    migrated.inventorySlots = packed;
  }

  return migrated;
}

/**
 * Migrates a v2 save to v3 — a pure version bump. The new persisted fields
 * (dayClock, hearts, hunger, spawnPoint) are optional, so an older save simply
 * loads with the engine's defaults for them.
 */
export function migrateSaveV2toV3(save: SaveDataV2): SaveDataV3 {
  return { ...save, version: 3 };
}

/**
 * Migrates a v3 save to v4 — a pure version bump. `blockEntities` (chest
 * contents) is optional, so a pre-chest save simply loads with no containers.
 */
export function migrateSaveV3toV4(save: SaveDataV3): SaveData {
  return { ...save, version: 4 };
}

// Storage is injectable so save logic can be tested without a browser.
export function readSave(saveKey: string, storage: Storage = localStorage): SaveData | null {
  try {
    const raw = storage.getItem(saveKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveData | SaveDataV3 | SaveDataV2 | SaveDataV1;
    if (!parsed || !Number.isFinite(parsed.seed) || !Array.isArray(parsed.changes)) return null;
    let migrated: SaveDataV2 | SaveDataV3 | SaveData = parsed.version === 1 ? migrateSaveV1toV2(parsed) : parsed;
    if (migrated.version === 2) migrated = migrateSaveV2toV3(migrated);
    if (migrated.version === 3) migrated = migrateSaveV3toV4(migrated);
    if (migrated.version !== 4) return null;
    return migrated;
  } catch {
    return null;
  }
}

export function writeSave(saveKey: string, data: SaveData, storage: Storage = localStorage): void {
  storage.setItem(saveKey, JSON.stringify(data));
}

export function inventorySlotsSnapshot(inventory: InventorySlot[]): SavedSlot[] {
  return inventory.map((slot) => ({ id: slot.id, count: slot.count, durability: slot.durability }));
}

/**
 * Rebuilds one slot from its saved snapshot: drops unknown ids, clamps the
 * count, and clamps/defaults durability for gear (a non-positive saved
 * durability means the piece broke and is dropped). Returns an empty slot for
 * anything invalid. Shared by inventory and container restore.
 */
function restoreSlot(saved: SavedSlot | undefined): InventorySlot {
  if (!saved?.id || saved.count <= 0 || !ITEM_DEF_BY_ID[saved.id]) return createEmptySlot();
  const slot = createSlot(saved.id, Math.min(maxStackSizeForItem(saved.id), Math.max(0, Math.floor(saved.count))));
  if ((slot.kind === "tool" || slot.kind === "weapon" || slot.kind === "armor") && slot.maxDurability) {
    if (typeof saved.durability === "number") {
      const loaded = Math.floor(saved.durability);
      if (loaded <= 0) return createEmptySlot();
      slot.durability = Math.max(1, Math.min(slot.maxDurability, loaded));
    } else {
      slot.durability = slot.maxDurability;
    }
  }
  return slot;
}

/** Snapshots non-empty chest containers for persistence (empty chests carry no data). */
export function serializeContainers(containers: Map<number, InventorySlot[]>): SavedContainer[] {
  const out: SavedContainer[] = [];
  for (const [index, slots] of containers) {
    if (!slots.some((slot) => slot.id && slot.count > 0)) continue;
    out.push({ index, slots: inventorySlotsSnapshot(slots) });
  }
  return out;
}

/**
 * Reads chest containers from a save into validated, CHEST_SLOTS-length slot
 * arrays keyed by voxel index. Per-slot validation only — the engine still
 * confirms each index actually holds a Chest block before using it.
 */
export function readContainers(save: SaveData): Array<{ index: number; slots: InventorySlot[] }> {
  if (!Array.isArray(save.blockEntities)) return [];
  const out: Array<{ index: number; slots: InventorySlot[] }> = [];
  for (const entry of save.blockEntities) {
    if (!entry || !Number.isFinite(entry.index) || !Array.isArray(entry.slots)) continue;
    const slots = Array.from({ length: CHEST_SLOTS }, (_, i) => restoreSlot(entry.slots[i]));
    out.push({ index: entry.index, slots });
  }
  return out;
}

/**
 * Rebuilds inventory slots from a save, dropping unknown items, clamping
 * counts and durability, and skipping broken gear. Supports both the current
 * inventorySlots shape and the legacy inventoryCounts shape. Returns null when
 * the save carries no inventory.
 */
export function restoreInventorySlots(save: SaveData): InventorySlot[] | null {
  if (Array.isArray(save.inventorySlots)) {
    const slots = Array.from({ length: INVENTORY_SLOTS }, () => createEmptySlot());
    for (let i = 0; i < Math.min(INVENTORY_SLOTS, save.inventorySlots.length); i += 1) {
      slots[i] = restoreSlot(save.inventorySlots[i]);
    }
    return slots;
  }

  if (save.inventoryCounts) {
    const slots = Array.from({ length: INVENTORY_SLOTS }, () => createEmptySlot());
    let cursor = 0;
    for (const [id, raw] of Object.entries(save.inventoryCounts)) {
      if (!ITEM_DEF_BY_ID[id]) continue;
      let remaining = Math.max(0, Math.floor(raw));
      while (remaining > 0 && cursor < slots.length) {
        const add = Math.min(maxStackSizeForItem(id), remaining);
        slots[cursor] = createSlot(id, add);
        cursor += 1;
        remaining -= add;
      }
    }
    return slots;
  }

  return null;
}

/** Restores equipped armor from a save, ignoring ids that are not valid armor for the slot. */
export function restoreEquippedArmor(save: SaveData): EquippedArmor | null {
  if (!save.equippedArmor) return null;
  const next = createEmptyArmorEquipment();
  for (const armorSlot of ARMOR_SLOTS) {
    const equippedId = save.equippedArmor[armorSlot];
    if (!equippedId) continue;
    const def = ITEM_DEF_BY_ID[equippedId];
    if (def?.kind !== "armor" || def.armorSlot !== armorSlot) continue;
    next[armorSlot] = equippedId;
  }
  return next;
}

export function restoreSelectedSlot(save: SaveData): number | null {
  if (typeof save.selectedSlot !== "number") return null;
  return normalizeSelectedSlot(save.selectedSlot);
}

/** Restores the day clock from a save (finite, non-negative); null if absent/invalid. */
export function restoreDayClock(save: SaveData): number | null {
  if (typeof save.dayClock !== "number" || !Number.isFinite(save.dayClock) || save.dayClock < 0) return null;
  return save.dayClock;
}

/** Restores hearts clamped to 1..MAX_HEARTS; null if absent/invalid. */
export function restoreHearts(save: SaveData): number | null {
  if (typeof save.hearts !== "number" || !Number.isFinite(save.hearts)) return null;
  return Math.max(1, Math.min(MAX_HEARTS, Math.floor(save.hearts)));
}

/** Restores hunger clamped to 0..MAX_HUNGER; null if absent/invalid. */
export function restoreHungerLevel(save: SaveData): number | null {
  if (typeof save.hunger !== "number" || !Number.isFinite(save.hunger)) return null;
  return Math.max(0, Math.min(MAX_HUNGER, Math.floor(save.hunger)));
}

/** Restores the bed respawn point; null if absent or explicitly cleared. */
export function restoreSpawnPoint(save: SaveData): { x: number; y: number; z: number } | null {
  const sp = save.spawnPoint;
  if (!sp || !Number.isFinite(sp.x) || !Number.isFinite(sp.y) || !Number.isFinite(sp.z)) return null;
  return { x: Math.floor(sp.x), y: Math.floor(sp.y), z: Math.floor(sp.z) };
}
