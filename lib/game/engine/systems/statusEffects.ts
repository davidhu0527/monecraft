import {
  EFFECT_HASTE_MULTIPLIER,
  EFFECT_JUMP_BOOST_VELOCITY,
  EFFECT_REGEN_HP,
  EFFECT_REGEN_INTERVAL,
  EFFECT_RESISTANCE_MULTIPLIER,
  EFFECT_SPEED_MULTIPLIER,
  EFFECT_STRENGTH_BONUS,
  MAX_HEARTS,
  POISON_HP,
  POISON_INTERVAL
} from "@/lib/game/config";
import type { EffectId } from "@/lib/game/types";
import type { EmitGameEvent, PlayerState } from "../state";

/**
 * Status-effect core. Effects live in `player.effects` (a Map of id → remaining
 * seconds) — session-state that persists across reload (save v6) but is cleared
 * on death. Each effect is read by exactly one seam: Speed multiplies movement
 * (`playerMotion`), Strength adds melee damage (`GameEngine` attack dispatch),
 * Fire Resistance / Water Breathing gate the lava / drowning ticks
 * (`playerStats`), and Regeneration / Poison are applied here on their own
 * accumulators each tick.
 */

/** Stable HUD/iteration order for the effects readout. */
export const EFFECT_ORDER: readonly EffectId[] = [
  "speed",
  "strength",
  "haste",
  "resistance",
  "jump_boost",
  "regeneration",
  "fire_resistance",
  "water_breathing",
  "poison"
];

export function hasEffect(player: PlayerState, id: EffectId): boolean {
  return (player.effects.get(id) ?? 0) > 0;
}

export function effectRemaining(player: PlayerState, id: EffectId): number {
  return player.effects.get(id) ?? 0;
}

/** Adds (or refreshes) an effect to at least `seconds` remaining — never shortens a longer one. */
export function addEffect(player: PlayerState, id: EffectId, seconds: number): void {
  if (seconds <= 0) return;
  player.effects.set(id, Math.max(player.effects.get(id) ?? 0, seconds));
}

/** Drops every active effect and resets the periodic accumulators — used on death/respawn. */
export function clearEffects(player: PlayerState): void {
  player.effects.clear();
  player.timers.effectRegenTimer = 0;
  player.timers.effectPoisonTimer = 0;
}

/** Movement-speed multiplier from the Speed effect (1 when inactive). */
export function speedMultiplier(player: PlayerState): number {
  return hasEffect(player, "speed") ? EFFECT_SPEED_MULTIPLIER : 1;
}

/** Extra melee damage per hit from the Strength effect (0 when inactive). */
export function strengthBonus(player: PlayerState): number {
  return hasEffect(player, "strength") ? EFFECT_STRENGTH_BONUS : 0;
}

/** Mining-speed multiplier from the Haste effect (1 when inactive). */
export function hasteMultiplier(player: PlayerState): number {
  return hasEffect(player, "haste") ? EFFECT_HASTE_MULTIPLIER : 1;
}

/** Incoming armor-mitigated combat-damage multiplier from the Resistance effect (1 when inactive). */
export function resistanceMultiplier(player: PlayerState): number {
  return hasEffect(player, "resistance") ? EFFECT_RESISTANCE_MULTIPLIER : 1;
}

/** Extra jump launch velocity from the Jump Boost effect (0 when inactive). */
export function jumpBoostBonus(player: PlayerState): number {
  return hasEffect(player, "jump_boost") ? EFFECT_JUMP_BOOST_VELOCITY : 0;
}

export type StatusEffectDeps = {
  /** Armor-bypassing, never-lethal damage (poison) — emits playerHurt. */
  applyPoisonDamage: (amount: number) => void;
  emit: EmitGameEvent;
};

/**
 * Advances every active effect by dt: counts each down (emitting `effectExpired`
 * at zero), then applies Regeneration (heals on its own cadence, even at low
 * hunger) and Poison (chips away but can't kill). Runs after `tickHealthRegen`
 * and before the environmental ticks so the fire-resist / water-breathing gates
 * are current when lava / oxygen read them.
 */
export function tickStatusEffects(player: PlayerState, dt: number, deps: StatusEffectDeps): void {
  for (const [id, remaining] of player.effects) {
    const next = remaining - dt;
    if (next <= 0) {
      player.effects.delete(id);
      deps.emit({ type: "effectExpired", effect: id });
    } else {
      player.effects.set(id, next);
    }
  }

  // Regeneration: heal on an independent accumulator, ignoring the hunger gate.
  if (hasEffect(player, "regeneration")) {
    player.timers.effectRegenTimer += dt;
    while (player.timers.effectRegenTimer >= EFFECT_REGEN_INTERVAL) {
      player.timers.effectRegenTimer -= EFFECT_REGEN_INTERVAL;
      if (player.hearts < MAX_HEARTS) player.hearts = Math.min(MAX_HEARTS, player.hearts + EFFECT_REGEN_HP);
    }
  } else {
    player.timers.effectRegenTimer = 0;
  }

  // Poison: never-lethal damage over time (the deps wrapper floors at half a heart).
  if (hasEffect(player, "poison")) {
    player.timers.effectPoisonTimer += dt;
    while (player.timers.effectPoisonTimer >= POISON_INTERVAL) {
      player.timers.effectPoisonTimer -= POISON_INTERVAL;
      deps.applyPoisonDamage(POISON_HP);
    }
  } else {
    player.timers.effectPoisonTimer = 0;
  }
}
