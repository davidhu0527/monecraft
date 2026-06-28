import { ANVIL_MATERIAL_REPAIR_PCT, ANVIL_REPAIR_BONUS_PCT, CUSTOM_NAME_MAX_LEN } from "@/lib/game/config";
import { ENCHANTMENT_DEFS } from "@/lib/game/enchantments";
import { REPAIR_MATERIAL_BY_ITEM } from "@/lib/game/items";
import type { Enchantment, EnchantmentId, InventorySlot } from "@/lib/game/types";

/**
 * Pure anvil logic: repairing, combining, and renaming durable gear. The engine
 * command handlers (GameEngine.dispatch) spend XP and mutate the inventory; these
 * helpers only compute the results, so they're trivially testable and side-effect
 * free. Durable gear is always count:1, so combine/repair never split a stack.
 */

/** Whether a slot is durable gear the anvil can act on. */
export function isAnvilGear(slot: InventorySlot | null | undefined): boolean {
  return !!slot?.id && slot.count > 0 && !!slot.maxDurability && (slot.kind === "tool" || slot.kind === "weapon" || slot.kind === "armor");
}

/** Merge two enchant lists, taking the higher level per id, each capped at its def's maxLevel. */
export function mergeEnchantments(a: Enchantment[] = [], b: Enchantment[] = []): Enchantment[] {
  const byId = new Map<EnchantmentId, number>();
  for (const e of [...a, ...b]) byId.set(e.id, Math.max(byId.get(e.id) ?? 0, e.level));
  const out: Enchantment[] = [];
  for (const [id, level] of byId) out.push({ id, level: Math.min(ENCHANTMENT_DEFS[id].maxLevel, level) });
  return out;
}

/** Index of another slot holding the same durable item id (count > 0), excluding `selectedSlot`; -1 if none. */
export function findSacrificeIndex(slots: InventorySlot[], selectedSlot: number): number {
  const target = slots[selectedSlot];
  if (!isAnvilGear(target)) return -1;
  for (let i = 0; i < slots.length; i += 1) {
    if (i === selectedSlot) continue;
    const s = slots[i];
    if (s.id === target.id && s.count > 0 && s.maxDurability) return i;
  }
  return -1;
}

/** True when combining would do real work — raise durability or add/raise an enchantment. */
export function wouldCombineHelp(target: InventorySlot, sacrifice: InventorySlot): boolean {
  const max = target.maxDurability ?? 0;
  const needsRepair = (target.durability ?? max) < max;
  const merged = mergeEnchantments(target.enchantments, sacrifice.enchantments);
  const grows = merged.some((e) => (target.enchantments?.find((t) => t.id === e.id)?.level ?? 0) < e.level);
  return needsRepair || grows;
}

/** Merge a sacrifice into the target: combined durability + a bonus (capped), enchant union at the higher level. */
export function combineSlots(target: InventorySlot, sacrifice: InventorySlot): InventorySlot {
  const max = target.maxDurability!;
  const sum = (target.durability ?? max) + (sacrifice.durability ?? max) + Math.floor(max * ANVIL_REPAIR_BONUS_PCT);
  const enchantments = mergeEnchantments(target.enchantments, sacrifice.enchantments);
  return { ...target, durability: Math.min(max, sum), enchantments: enchantments.length ? enchantments : undefined };
}

/** The material id that repairs a slot's gear, or undefined if it has none. */
export function repairMaterialFor(slot: InventorySlot | null | undefined): string | undefined {
  return slot?.id ? REPAIR_MATERIAL_BY_ITEM[slot.id] : undefined;
}

/** Whether `slot` can be material-repaired now — it's damaged gear, has a repair material, and a unit is in stock. */
export function canMaterialRepair(slot: InventorySlot | null | undefined, inventory: InventorySlot[]): boolean {
  if (!isAnvilGear(slot)) return false;
  const max = slot!.maxDurability!;
  if ((slot!.durability ?? max) >= max) return false; // already full
  const material = repairMaterialFor(slot);
  if (!material) return false;
  return inventory.some((s) => s.id === material && s.count > 0);
}

/** Restore a fixed fraction of max durability (one material unit's worth), capped at max. */
export function materialRepair(slot: InventorySlot): InventorySlot {
  const max = slot.maxDurability!;
  const restored = Math.ceil(max * ANVIL_MATERIAL_REPAIR_PCT);
  return { ...slot, durability: Math.min(max, (slot.durability ?? max) + restored) };
}

/** Trim and cap a requested custom name; "" means clear it. */
export function sanitizeCustomName(raw: string): string {
  return raw.trim().slice(0, CUSTOM_NAME_MAX_LEN);
}
