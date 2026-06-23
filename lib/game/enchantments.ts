import {
  EFFICIENCY_SPEED_PER_LEVEL,
  ENCHANT_MAX_LEVEL,
  PROTECTION_DEFENSE_PER_LEVEL,
  SHARPNESS_DAMAGE_PER_LEVEL,
  UNBREAKING_SKIP_PER_LEVEL
} from "@/lib/game/config";
import type { Enchantment, EnchantmentId, InventorySlot, ItemKind } from "@/lib/game/types";

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
  maxLevel: number;
};

export const ENCHANTMENT_DEFS: Record<EnchantmentId, EnchantmentDef> = {
  sharpness: { id: "sharpness", label: "Sharpness", kinds: ["weapon"], maxLevel: ENCHANT_MAX_LEVEL },
  protection: { id: "protection", label: "Protection", kinds: ["armor"], maxLevel: ENCHANT_MAX_LEVEL },
  efficiency: { id: "efficiency", label: "Efficiency", kinds: ["tool"], maxLevel: ENCHANT_MAX_LEVEL },
  unbreaking: { id: "unbreaking", label: "Unbreaking", kinds: ["tool", "weapon", "armor"], maxLevel: ENCHANT_MAX_LEVEL }
};

/** Stable display order for the enchanting panel. */
export const ENCHANTMENT_ORDER: readonly EnchantmentId[] = ["sharpness", "protection", "efficiency", "unbreaking"];

/** Level of `id` on a slot (0 if absent). */
export function enchantLevel(slot: InventorySlot | null | undefined, id: EnchantmentId): number {
  return slot?.enchantments?.find((e) => e.id === id)?.level ?? 0;
}

/** Whether `id` can be applied to `slot` now — right item kind, owned, below its max level. */
export function canEnchant(slot: InventorySlot | null | undefined, id: EnchantmentId): boolean {
  if (!slot?.id || !slot.kind || slot.count <= 0) return false;
  const def = ENCHANTMENT_DEFS[id];
  return def.kinds.includes(slot.kind) && enchantLevel(slot, id) < def.maxLevel;
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
