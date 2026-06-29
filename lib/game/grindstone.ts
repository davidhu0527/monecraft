import { GRINDSTONE_REFUND_XP_PER_LEVEL } from "@/lib/game/config";
import type { InventorySlot } from "@/lib/game/types";

/**
 * Pure grindstone logic: removing enchantments from durable gear in exchange for
 * an XP refund. Like the anvil helpers, this only computes results — the engine
 * command spends/banks XP and mutates the inventory.
 */

/** Total enchantment levels on a slot (0 if none). */
export function totalEnchantLevels(slot: InventorySlot | null | undefined): number {
  return slot?.enchantments?.reduce((sum, e) => sum + e.level, 0) ?? 0;
}

/** Whether the grindstone can act on a slot — it carries at least one enchantment. */
export function canStripEnchantments(slot: InventorySlot | null | undefined): boolean {
  return totalEnchantLevels(slot) > 0;
}

/** XP points refunded for stripping a slot's enchantments. */
export function enchantRefund(slot: InventorySlot | null | undefined): number {
  return totalEnchantLevels(slot) * GRINDSTONE_REFUND_XP_PER_LEVEL;
}

/** A copy of the slot with all enchantments removed. */
export function stripEnchantments(slot: InventorySlot): InventorySlot {
  return { ...slot, enchantments: undefined };
}
