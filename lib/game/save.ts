import type { SaveDataV1, InventorySlot } from "@/lib/game/types";

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
