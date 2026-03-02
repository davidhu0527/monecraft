import type { SaveDataV1, InventorySlot } from "@/lib/game/types";

export function readSave(saveKey: string): SaveDataV1 | null {
  try {
    const raw = localStorage.getItem(saveKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveDataV1;
    if (parsed?.version !== 1 || !Number.isFinite(parsed.seed) || !Array.isArray(parsed.changes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSave(saveKey: string, data: SaveDataV1): void {
  localStorage.setItem(saveKey, JSON.stringify(data));
}

export function inventorySlotsSnapshot(inventory: InventorySlot[]): Array<{ id: string | null; count: number; durability?: number }> {
  return inventory.map((slot) => ({ id: slot.id, count: slot.count, durability: slot.durability }));
}
