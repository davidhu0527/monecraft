import { HOTBAR_SLOTS, INVENTORY_SLOTS, MAX_STACK_SIZE } from "@/lib/game/config";
import { ARMOR_SLOTS, createEmptyArmorEquipment, createEmptySlot, createSlot, ITEM_DEF_BY_ID } from "@/lib/game/items";
import type { EquippedArmor, SaveDataV1, InventorySlot } from "@/lib/game/types";

// Storage is injectable so save logic can be tested without a browser.
export function readSave(saveKey: string, storage: Storage = localStorage): SaveDataV1 | null {
  try {
    const raw = storage.getItem(saveKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveDataV1;
    if (parsed?.version !== 1 || !Number.isFinite(parsed.seed) || !Array.isArray(parsed.changes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSave(saveKey: string, data: SaveDataV1, storage: Storage = localStorage): void {
  storage.setItem(saveKey, JSON.stringify(data));
}

export function inventorySlotsSnapshot(inventory: InventorySlot[]): Array<{ id: string | null; count: number; durability?: number }> {
  return inventory.map((slot) => ({ id: slot.id, count: slot.count, durability: slot.durability }));
}

/**
 * Rebuilds inventory slots from a save, dropping unknown items, clamping
 * counts and durability, and skipping broken gear. Supports both the current
 * inventorySlots shape and the legacy inventoryCounts shape. Returns null when
 * the save carries no inventory.
 */
export function restoreInventorySlots(save: SaveDataV1): InventorySlot[] | null {
  if (Array.isArray(save.inventorySlots)) {
    const slots = Array.from({ length: INVENTORY_SLOTS }, () => createEmptySlot());
    for (let i = 0; i < Math.min(INVENTORY_SLOTS, save.inventorySlots.length); i += 1) {
      const saved = save.inventorySlots[i];
      if (!saved?.id || saved.count <= 0) continue;
      if (!ITEM_DEF_BY_ID[saved.id]) continue;
      const slot = createSlot(saved.id, Math.min(MAX_STACK_SIZE, Math.max(0, Math.floor(saved.count))));
      if ((slot.kind === "tool" || slot.kind === "weapon" || slot.kind === "armor") && slot.maxDurability) {
        if (typeof saved.durability === "number") {
          const loadedDurability = Math.floor(saved.durability);
          if (loadedDurability <= 0) continue;
          slot.durability = Math.max(1, Math.min(slot.maxDurability, loadedDurability));
        } else {
          slot.durability = slot.maxDurability;
        }
      }
      slots[i] = slot;
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
        const add = Math.min(MAX_STACK_SIZE, remaining);
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
export function restoreEquippedArmor(save: SaveDataV1): EquippedArmor | null {
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

export function restoreSelectedSlot(save: SaveDataV1): number | null {
  if (typeof save.selectedSlot !== "number") return null;
  return Math.max(0, Math.min(HOTBAR_SLOTS - 1, save.selectedSlot));
}
