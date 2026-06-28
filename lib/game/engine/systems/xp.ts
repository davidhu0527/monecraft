import { XP_PER_LEVEL } from "@/lib/game/config";
import { mendXp } from "@/lib/game/enchantments";
import { BlockId } from "@/lib/world";
import type { EmitGameEvent, GameState } from "../state";

/**
 * XP & levels. XP is banked as points in `state.xp`; `XP_PER_LEVEL` points make
 * one level. Levels are the currency spent at the enchanting table. XP accrues
 * from mob kills (`mobXp.ts`), ore mining (`ORE_XP` below), and fishing — and is
 * NOT cleared on death (unlike status effects), since it's a long-term currency.
 */

/** XP granted for mining each ore block; everything else yields none. */
const ORE_XP: Partial<Record<BlockId, number>> = {
  [BlockId.CoalOre]: 1,
  [BlockId.SliverOre]: 2,
  [BlockId.RubyOre]: 4,
  [BlockId.GoldOre]: 4,
  [BlockId.SapphireOre]: 6,
  [BlockId.DiamondOre]: 8
};

export function xpForBlock(block: BlockId): number {
  return ORE_XP[block] ?? 0;
}

/** Whole level from banked XP points. */
export function xpLevel(xp: number): number {
  return Math.floor(xp / XP_PER_LEVEL);
}

/** Progress toward the next level, 0..1. */
export function xpProgress(xp: number): number {
  return (xp % XP_PER_LEVEL) / XP_PER_LEVEL;
}

/**
 * Banks XP points (a no-op for ≤ 0), emitting `xpGained` so the HUD and audio react.
 * Mending first diverts some of the gained XP to repair damaged held/worn gear; only
 * the remainder is banked, but the event reports the gross amount so the HUD/audio
 * still react to the full pickup.
 */
export function awardXp(state: GameState, amount: number, emit: EmitGameEvent): void {
  if (amount <= 0) return;
  const { slots, equipped, xpLeft } = mendXp(state.inventory, state.selectedSlot, state.equippedArmor, amount);
  if (slots !== state.inventory) state.inventory = slots;
  if (equipped !== state.equippedArmor) state.equippedArmor = equipped;
  state.xp += xpLeft;
  emit({ type: "xpGained", amount });
}

/** Spends whole levels when affordable; returns true on success, false (unchanged) if too poor. */
export function spendXpLevels(state: GameState, levels: number): boolean {
  if (levels <= 0) return true;
  if (xpLevel(state.xp) < levels) return false;
  state.xp -= levels * XP_PER_LEVEL;
  return true;
}
