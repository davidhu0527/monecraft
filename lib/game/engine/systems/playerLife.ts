import { MAX_HEARTS, MAX_HUNGER, RESPAWN_SECONDS } from "@/lib/game/config";
import { armorReduction, consumeEquippedArmorDurability } from "@/lib/game/inventory";
import type { GameState } from "../state";

/**
 * Applies armor-mitigated damage (always at least 1) and wears equipped armor.
 * Returns true when the hit was lethal — the engine emits the death event.
 */
export function applyDamageWithArmor(state: GameState, amount: number, rng?: () => number): boolean {
  if (state.isDead) return false;
  const value = Math.max(0, Math.floor(amount));
  if (value <= 0) return false;

  state.inventory = consumeEquippedArmorDurability(state.inventory, state.equippedArmor, 1, rng) ?? state.inventory;
  const reduction = armorReduction(state.inventory, state.equippedArmor);
  const mitigated = Math.max(1, Math.floor(value * (1 - reduction)));

  state.hearts = Math.max(0, state.hearts - mitigated);
  if (state.hearts > 0) return false;

  state.isDead = true;
  state.respawnTimer = RESPAWN_SECONDS;
  return true;
}

/** Applies environmental damage exactly, bypassing armor and durability wear. */
export function applyUnmitigatedDamage(state: GameState, amount: number): boolean {
  if (state.isDead) return false;
  const value = Math.max(0, Math.floor(amount));
  if (value <= 0) return false;

  state.hearts = Math.max(0, state.hearts - value);
  if (state.hearts > 0) return false;

  state.isDead = true;
  state.respawnTimer = RESPAWN_SECONDS;
  return true;
}

/**
 * Applies armor-bypassing damage that can never be lethal: hearts never drop
 * below `floorHp`. Used by Poison, which should chip a player down to half a
 * heart yet never deliver the killing blow. Returns true when any damage landed.
 */
export function applyNonLethalDamage(state: GameState, amount: number, floorHp = 1): boolean {
  if (state.isDead) return false;
  const value = Math.max(0, Math.floor(amount));
  if (value <= 0 || state.hearts <= floorHp) return false;
  state.hearts = Math.max(floorHp, state.hearts - value);
  return true;
}

/**
 * Counts down the respawn timer while dead. Returns true when the player
 * comes back to life this tick — the engine then performs the respawn.
 */
export function tickRespawnTimer(state: GameState, dt: number): boolean {
  if (!state.isDead) return false;
  state.respawnTimer -= dt;
  if (state.respawnTimer > 0) return false;

  state.hearts = MAX_HEARTS;
  state.hunger = MAX_HUNGER;
  state.isDead = false;
  state.respawnTimer = 0;
  state.timers.waterExposureTimer = 0;
  state.timers.waterDamageTimer = 0;
  return true;
}
