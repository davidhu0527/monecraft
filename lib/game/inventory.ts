import { MAX_STACK_SIZE } from "@/lib/game/config";
import { ARMOR_SLOTS, createEmptySlot, createSlot, ITEM_DEF_BY_ID } from "@/lib/game/items";
import type { EquippedArmor, InventorySlot, Recipe } from "@/lib/game/types";

/**
 * Pure inventory slot algebra. Every mutation returns a NEW slots array, or
 * null when the operation does not apply — callers keep the previous array on
 * null, so reference equality doubles as a change signal for React.
 */

export function cloneSlots(slots: InventorySlot[]): InventorySlot[] {
  return slots.map((slot) => ({ ...slot }));
}

export function countsById(slots: InventorySlot[]): Map<string, number> {
  const byId = new Map<string, number>();
  for (const slot of slots) {
    if (!slot.id || slot.count <= 0) continue;
    byId.set(slot.id, (byId.get(slot.id) ?? 0) + slot.count);
  }
  return byId;
}

/**
 * Adds (delta > 0) or removes (delta < 0) items. Removal is all-or-nothing:
 * if the inventory holds fewer than |delta|, nothing is removed and null is
 * returned. Addition fills existing stacks, then empty slots; whatever does
 * not fit is dropped (a full inventory loses surplus block drops).
 */
export function adjustSlotCount(slots: InventorySlot[], slotId: string, delta: number, preferredIndex?: number): InventorySlot[] | null {
  if (!slotId || delta === 0) return null;
  const next = cloneSlots(slots);
  let remaining = Math.abs(delta);

  if (delta < 0) {
    const consumeFromIndex = (index: number) => {
      if (remaining <= 0) return;
      if (index < 0 || index >= next.length) return;
      const slot = next[index];
      if (slot.id !== slotId || slot.count <= 0) return;
      const take = Math.min(remaining, slot.count);
      slot.count -= take;
      remaining -= take;
      if (slot.count <= 0) next[index] = createEmptySlot();
    };

    if (typeof preferredIndex === "number") consumeFromIndex(preferredIndex);
    for (let i = 0; i < next.length && remaining > 0; i += 1) consumeFromIndex(i);
    if (remaining > 0) return null;
    return next;
  }

  if (!ITEM_DEF_BY_ID[slotId]) return null;

  const fillIndex = (index: number) => {
    if (remaining <= 0) return;
    if (index < 0 || index >= next.length) return;
    const slot = next[index];
    if (slot.id !== slotId || slot.count >= MAX_STACK_SIZE) return;
    const add = Math.min(remaining, MAX_STACK_SIZE - slot.count);
    slot.count += add;
    remaining -= add;
  };

  if (typeof preferredIndex === "number") fillIndex(preferredIndex);
  for (let i = 0; i < next.length && remaining > 0; i += 1) fillIndex(i);
  for (let i = 0; i < next.length && remaining > 0; i += 1) {
    if (next[i].id !== null || next[i].count !== 0) continue;
    const add = Math.min(remaining, MAX_STACK_SIZE);
    next[i] = createSlot(slotId, add);
    remaining -= add;
  }
  return next;
}

/** Wears the tool/weapon at `index` by `amount`; the slot empties at zero durability. */
export function consumeToolDurability(slots: InventorySlot[], index: number, amount = 1): InventorySlot[] | null {
  if (amount <= 0) return null;
  if (index < 0 || index >= slots.length) return null;
  const next = cloneSlots(slots);
  const slot = next[index];
  if ((slot.kind !== "tool" && slot.kind !== "weapon") || !slot.id || slot.count <= 0 || !slot.maxDurability) return null;
  const nextDurability = (slot.durability ?? slot.maxDurability) - amount;
  if (nextDurability <= 0) {
    next[index] = createEmptySlot();
    return next;
  }
  slot.durability = nextDurability;
  return next;
}

/** Wears every equipped armor piece by `amount`; broken pieces disappear. */
export function consumeEquippedArmorDurability(slots: InventorySlot[], equipped: EquippedArmor, amount = 1): InventorySlot[] | null {
  if (amount <= 0) return null;
  const next = cloneSlots(slots);
  let changed = false;
  for (const armorSlot of ARMOR_SLOTS) {
    const equippedId = equipped[armorSlot];
    if (!equippedId) continue;
    const idx = next.findIndex((slot) => slot.id === equippedId && slot.kind === "armor" && slot.count > 0);
    if (idx < 0) continue;
    const slot = next[idx];
    if (!slot.maxDurability) continue;
    const nextDurability = (slot.durability ?? slot.maxDurability) - amount;
    if (nextDurability <= 0) next[idx] = createEmptySlot();
    else slot.durability = nextDurability;
    changed = true;
  }
  return changed ? next : null;
}

export function canCraft(slots: InventorySlot[], recipe: Recipe): boolean {
  const byId = countsById(slots);
  const hasCost = recipe.cost.every((cost) => (byId.get(cost.slotId) ?? 0) >= cost.count);
  if (!hasCost) return false;

  let freeForResult = 0;
  for (const slot of slots) {
    if (slot.id === recipe.result.slotId) freeForResult += MAX_STACK_SIZE - slot.count;
    if (slot.id === null && slot.count === 0) freeForResult += MAX_STACK_SIZE;
  }
  return freeForResult >= recipe.result.count;
}

/**
 * Consumes the recipe cost and adds the result. Returns null unless the cost
 * is affordable AND the result fits — crafting never silently destroys the
 * overflow (this previously could happen when the inventory was full).
 */
export function craft(slots: InventorySlot[], recipe: Recipe): InventorySlot[] | null {
  if (!ITEM_DEF_BY_ID[recipe.result.slotId]) return null;
  if (!canCraft(slots, recipe)) return null;

  const next = cloneSlots(slots);
  for (const cost of recipe.cost) {
    let remaining = cost.count;
    for (let i = 0; i < next.length && remaining > 0; i += 1) {
      if (next[i].id !== cost.slotId || next[i].count <= 0) continue;
      const take = Math.min(remaining, next[i].count);
      next[i].count -= take;
      remaining -= take;
      if (next[i].count <= 0) next[i] = createEmptySlot();
    }
  }

  let remaining = recipe.result.count;
  for (let i = 0; i < next.length && remaining > 0; i += 1) {
    if (next[i].id !== recipe.result.slotId || next[i].count >= MAX_STACK_SIZE) continue;
    const add = Math.min(remaining, MAX_STACK_SIZE - next[i].count);
    next[i].count += add;
    remaining -= add;
  }
  for (let i = 0; i < next.length && remaining > 0; i += 1) {
    if (next[i].id !== null || next[i].count !== 0) continue;
    const add = Math.min(remaining, MAX_STACK_SIZE);
    next[i] = createSlot(recipe.result.slotId, add);
    remaining -= add;
  }
  return next;
}

export function swapSlots(slots: InventorySlot[], fromIndex: number, toIndex: number): InventorySlot[] | null {
  if (fromIndex === toIndex) return null;
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= slots.length || toIndex >= slots.length) return null;
  const next = cloneSlots(slots);
  const temp = next[fromIndex];
  next[fromIndex] = next[toIndex];
  next[toIndex] = temp;
  return next;
}

/** Toggles the armor piece at `index` in its armor slot. */
export function toggleEquipArmor(slots: InventorySlot[], equipped: EquippedArmor, index: number): EquippedArmor | null {
  if (index < 0 || index >= slots.length) return null;
  const slot = slots[index];
  if (slot.kind !== "armor" || !slot.id || !slot.armorSlot || slot.count <= 0) return null;
  const next = { ...equipped };
  next[slot.armorSlot] = equipped[slot.armorSlot] === slot.id ? null : slot.id;
  return next;
}

/** Unequips armor pieces no longer present in the inventory (broken or dropped). */
export function unequipMissingArmor(slots: InventorySlot[], equipped: EquippedArmor): EquippedArmor | null {
  let changed = false;
  const next = { ...equipped };
  for (const armorSlot of ARMOR_SLOTS) {
    const equippedId = next[armorSlot];
    if (!equippedId) continue;
    const stillOwned = slots.some((slot) => slot.id === equippedId && slot.count > 0);
    if (stillOwned) continue;
    next[armorSlot] = null;
    changed = true;
  }
  return changed ? next : null;
}

/** Damage reduction from equipped, still-owned armor: 5% per defense point, capped at 75%. */
export function armorReduction(slots: InventorySlot[], equipped: EquippedArmor): number {
  let defense = 0;
  for (const armorSlot of ARMOR_SLOTS) {
    const equippedId = equipped[armorSlot];
    if (!equippedId) continue;
    const def = ITEM_DEF_BY_ID[equippedId];
    if (!def || def.kind !== "armor" || def.armorSlot !== armorSlot) continue;
    const hasOwnedPiece = slots.some((slot) => slot.id === equippedId && slot.count > 0);
    if (!hasOwnedPiece) continue;
    defense += def.defense ?? 0;
  }
  return Math.min(0.75, defense * 0.05);
}
