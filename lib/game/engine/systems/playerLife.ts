import { MAX_HEARTS, MAX_HUNGER, RESPAWN_SECONDS } from "@/lib/game/config";
import { takesDamage } from "@/lib/game/gameModes";
import { armorReduction, consumeEquippedArmorDurability } from "@/lib/game/inventory";
import { resistanceMultiplier } from "./statusEffects";
import type { PlayerState } from "../state";

/**
 * Applies armor-mitigated damage (always at least 1) and wears equipped armor.
 * The Resistance effect further scales the post-armor amount (combat damage only —
 * environmental/poison damage uses the unmitigated/non-lethal paths below).
 * Returns true when the hit was lethal — the engine emits the death event.
 * Creative/Spectator are invulnerable, so every damage source no-ops here.
 */
export function applyDamageWithArmor(player: PlayerState, amount: number, rng?: () => number): boolean {
  if (player.isDead || !takesDamage(player.gameMode)) return false;
  const value = Math.max(0, Math.floor(amount));
  if (value <= 0) return false;

  player.equippedArmor = consumeEquippedArmorDurability(player.equippedArmor, 1, rng) ?? player.equippedArmor;
  const reduction = armorReduction(player.equippedArmor);
  const mitigated = Math.max(1, Math.floor(value * (1 - reduction) * resistanceMultiplier(player)));

  player.hearts = Math.max(0, player.hearts - mitigated);
  if (player.hearts > 0) return false;

  player.isDead = true;
  player.respawnTimer = RESPAWN_SECONDS;
  return true;
}

/** Applies environmental damage exactly, bypassing armor and durability wear. */
export function applyUnmitigatedDamage(player: PlayerState, amount: number): boolean {
  if (player.isDead || !takesDamage(player.gameMode)) return false;
  const value = Math.max(0, Math.floor(amount));
  if (value <= 0) return false;

  player.hearts = Math.max(0, player.hearts - value);
  if (player.hearts > 0) return false;

  player.isDead = true;
  player.respawnTimer = RESPAWN_SECONDS;
  return true;
}

/**
 * Applies armor-bypassing damage that can never be lethal: hearts never drop
 * below `floorHp`. Used by Poison, which should chip a player down to half a
 * heart yet never deliver the killing blow. Returns true when any damage landed.
 */
export function applyNonLethalDamage(player: PlayerState, amount: number, floorHp = 1): boolean {
  if (player.isDead || !takesDamage(player.gameMode)) return false;
  const value = Math.max(0, Math.floor(amount));
  if (value <= 0 || player.hearts <= floorHp) return false;
  player.hearts = Math.max(floorHp, player.hearts - value);
  return true;
}

/**
 * Counts down the respawn timer while dead. Returns true when the player
 * comes back to life this tick — the engine then performs the respawn.
 */
export function tickRespawnTimer(player: PlayerState, dt: number): boolean {
  if (!player.isDead) return false;
  player.respawnTimer -= dt;
  if (player.respawnTimer > 0) return false;

  player.hearts = MAX_HEARTS;
  player.hunger = MAX_HUNGER;
  player.isDead = false;
  player.respawnTimer = 0;
  player.timers.waterExposureTimer = 0;
  player.timers.waterDamageTimer = 0;
  return true;
}
