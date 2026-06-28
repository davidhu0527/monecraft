import {
  EFFICIENCY_SPEED_PER_LEVEL,
  ENCHANT_MAX_LEVEL,
  MENDING_MAX_LEVEL,
  MENDING_REPAIR_PER_XP,
  POWER_DAMAGE_PER_LEVEL,
  PROTECTION_DEFENSE_PER_LEVEL,
  PUNCH_KNOCKBACK_PER_LEVEL,
  SHARPNESS_DAMAGE_PER_LEVEL,
  UNBREAKING_SKIP_PER_LEVEL
} from "@/lib/game/config";
import { ARMOR_SLOTS } from "@/lib/game/items";
import type { Enchantment, EnchantmentId, EquippedArmor, InventorySlot, ItemKind } from "@/lib/game/types";

/**
 * Enchantments are per-item-instance data (like durability) applied at the
 * enchanting table. Each is a flat per-level modifier read at exactly one
 * existing seam — the same one-reader-per-seam discipline as status effects:
 * Sharpness → melee damage, Protection → equipped defense, Efficiency → mining
 * speed, Unbreaking → durability wear. Applies only to durable gear.
 */

export type EnchantmentDef = {
  id: EnchantmentId;
  label: string;
  /** Item kinds this enchantment can be applied to. */
  kinds: ItemKind[];
  /**
   * Optional allow-list of specific item ids: when set, the slot's item must be
   * one of these (on top of the `kinds` gate). Used to bind a weapon enchant to a
   * single item — Power/Punch are bow-only, not for swords (which also are `weapon`).
   */
  itemIds?: string[];
  maxLevel: number;
};

export const ENCHANTMENT_DEFS: Record<EnchantmentId, EnchantmentDef> = {
  sharpness: { id: "sharpness", label: "Sharpness", kinds: ["weapon"], maxLevel: ENCHANT_MAX_LEVEL },
  protection: { id: "protection", label: "Protection", kinds: ["armor"], maxLevel: ENCHANT_MAX_LEVEL },
  efficiency: { id: "efficiency", label: "Efficiency", kinds: ["tool"], maxLevel: ENCHANT_MAX_LEVEL },
  unbreaking: { id: "unbreaking", label: "Unbreaking", kinds: ["tool", "weapon", "armor"], maxLevel: ENCHANT_MAX_LEVEL },
  mending: { id: "mending", label: "Mending", kinds: ["tool", "weapon", "armor"], maxLevel: MENDING_MAX_LEVEL },
  power: { id: "power", label: "Power", kinds: ["weapon"], itemIds: ["bow"], maxLevel: ENCHANT_MAX_LEVEL },
  punch: { id: "punch", label: "Punch", kinds: ["weapon"], itemIds: ["bow"], maxLevel: ENCHANT_MAX_LEVEL }
};

/** Stable display order for the enchanting panel. */
export const ENCHANTMENT_ORDER: readonly EnchantmentId[] = ["sharpness", "power", "punch", "protection", "efficiency", "unbreaking", "mending"];

/** Level of `id` on a slot (0 if absent). */
export function enchantLevel(slot: InventorySlot | null | undefined, id: EnchantmentId): number {
  return slot?.enchantments?.find((e) => e.id === id)?.level ?? 0;
}

/** Whether `id` can be applied to `slot` now — right item kind (and specific item, if gated), owned, below its max level. */
export function canEnchant(slot: InventorySlot | null | undefined, id: EnchantmentId): boolean {
  if (!slot?.id || !slot.kind || slot.count <= 0) return false;
  const def = ENCHANTMENT_DEFS[id];
  if (!def.kinds.includes(slot.kind)) return false;
  if (def.itemIds && !def.itemIds.includes(slot.id)) return false; // item-specific enchant (e.g. bow-only Power/Punch)
  return enchantLevel(slot, id) < def.maxLevel;
}

/** A new slot with `id` added (level 1) or its level bumped by one; returns the slot unchanged if not allowed. */
export function applyEnchant(slot: InventorySlot, id: EnchantmentId): InventorySlot {
  if (!canEnchant(slot, id)) return slot;
  const current = slot.enchantments ?? [];
  const enchantments: Enchantment[] = current.some((e) => e.id === id)
    ? current.map((e) => (e.id === id ? { id, level: e.level + 1 } : e))
    : [...current, { id, level: 1 }];
  return { ...slot, enchantments };
}

// --- Seam readers ---

/** Extra melee damage from Sharpness on the held weapon. */
export function sharpnessBonus(slot: InventorySlot | null | undefined): number {
  return enchantLevel(slot, "sharpness") * SHARPNESS_DAMAGE_PER_LEVEL;
}

/** Extra arrow damage from Power on the held bow. */
export function powerBonus(slot: InventorySlot | null | undefined): number {
  return enchantLevel(slot, "power") * POWER_DAMAGE_PER_LEVEL;
}

/** Extra arrow knockback from Punch on the held bow. */
export function punchKnockback(slot: InventorySlot | null | undefined): number {
  return enchantLevel(slot, "punch") * PUNCH_KNOCKBACK_PER_LEVEL;
}

/** Extra defense points from Protection on a worn armor piece. */
export function protectionDefense(slot: InventorySlot | null | undefined): number {
  return enchantLevel(slot, "protection") * PROTECTION_DEFENSE_PER_LEVEL;
}

/** Mining-speed multiplier from Efficiency on the held tool (1 when absent). */
export function efficiencyMultiplier(slot: InventorySlot | null | undefined): number {
  return 1 + enchantLevel(slot, "efficiency") * EFFICIENCY_SPEED_PER_LEVEL;
}

/** Whether Unbreaking should skip a point of durability wear this time. */
export function unbreakingSkips(slot: InventorySlot | null | undefined, rng: () => number): boolean {
  const level = enchantLevel(slot, "unbreaking");
  return level > 0 && rng() < level * UNBREAKING_SKIP_PER_LEVEL;
}

/** Repairs one Mending slot with up to `xp` points; returns the repaired slot + XP used, or null when there's nothing to do. */
function repairWithXp(slot: InventorySlot | null | undefined, xp: number): { slot: InventorySlot; xpUsed: number } | null {
  if (!slot?.maxDurability || enchantLevel(slot, "mending") <= 0) return null;
  const missing = slot.maxDurability - (slot.durability ?? slot.maxDurability);
  if (missing <= 0) return null;
  const xpNeeded = Math.ceil(missing / MENDING_REPAIR_PER_XP);
  const xpUsed = Math.min(xp, xpNeeded);
  const repaired = Math.min(missing, xpUsed * MENDING_REPAIR_PER_XP);
  return { slot: { ...slot, durability: (slot.durability ?? slot.maxDurability) + repaired }, xpUsed };
}

/**
 * Mending seam: diverts gained XP to repair the player's damaged, Mending-enchanted
 * gear — the held item first, then worn armor in ARMOR_SLOTS order — at
 * MENDING_REPAIR_PER_XP durability per diverted XP point. Returns (possibly new)
 * slots + equipped records (same refs when nothing was repaired) plus the XP left
 * to bank. The one reader for Mending: `awardXp` is its only caller.
 */
export function mendXp(
  slots: InventorySlot[],
  selectedSlot: number,
  equipped: EquippedArmor,
  xp: number
): { slots: InventorySlot[]; equipped: EquippedArmor; xpLeft: number } {
  if (xp <= 0) return { slots, equipped, xpLeft: xp };
  let remaining = xp;
  let nextSlots = slots;
  let nextEquipped = equipped;

  // Held item first (worn armor lives in `equipped`, a disjoint store).
  if (remaining > 0 && selectedSlot >= 0 && selectedSlot < slots.length) {
    const r = repairWithXp(slots[selectedSlot], remaining);
    if (r) {
      nextSlots = slots.slice();
      nextSlots[selectedSlot] = r.slot;
      remaining -= r.xpUsed;
    }
  }

  // Then each worn armor piece.
  for (const armorSlot of ARMOR_SLOTS) {
    if (remaining <= 0) break;
    const r = repairWithXp(nextEquipped[armorSlot], remaining);
    if (!r) continue;
    if (nextEquipped === equipped) nextEquipped = { ...equipped }; // clone on first write
    nextEquipped[armorSlot] = r.slot;
    remaining -= r.xpUsed;
  }

  return { slots: nextSlots, equipped: nextEquipped, xpLeft: remaining };
}
