import {
  EFFECT_REGEN_HP,
  EFFECT_REGEN_INTERVAL,
  EFFECT_SPEED_MULTIPLIER,
  EFFECT_STRENGTH_BONUS,
  MAX_HEARTS,
  POISON_HP,
  POISON_INTERVAL
} from "@/lib/game/config";
import type { EffectId } from "@/lib/game/types";
import type { EmitGameEvent, GameState } from "../state";

/**
 * Status-effect core. Effects live in `state.effects` (a Map of id → remaining
 * seconds) — session-state that persists across reload (save v6) but is cleared
 * on death. Each effect is read by exactly one seam: Speed multiplies movement
 * (`playerMotion`), Strength adds melee damage (`GameEngine` attack dispatch),
 * Fire Resistance / Water Breathing gate the lava / drowning ticks
 * (`playerStats`), and Regeneration / Poison are applied here on their own
 * accumulators each tick.
 */

/** Stable HUD/iteration order for the effects readout. */
export const EFFECT_ORDER: readonly EffectId[] = ["speed", "strength", "regeneration", "fire_resistance", "water_breathing", "poison"];

export function hasEffect(state: GameState, id: EffectId): boolean {
  return (state.effects.get(id) ?? 0) > 0;
}

export function effectRemaining(state: GameState, id: EffectId): number {
  return state.effects.get(id) ?? 0;
}

/** Adds (or refreshes) an effect to at least `seconds` remaining — never shortens a longer one. */
export function addEffect(state: GameState, id: EffectId, seconds: number): void {
  if (seconds <= 0) return;
  state.effects.set(id, Math.max(state.effects.get(id) ?? 0, seconds));
}

/** Drops every active effect and resets the periodic accumulators — used on death/respawn. */
export function clearEffects(state: GameState): void {
  state.effects.clear();
  state.timers.effectRegenTimer = 0;
  state.timers.effectPoisonTimer = 0;
}

/** Movement-speed multiplier from the Speed effect (1 when inactive). */
export function speedMultiplier(state: GameState): number {
  return hasEffect(state, "speed") ? EFFECT_SPEED_MULTIPLIER : 1;
}

/** Extra melee damage per hit from the Strength effect (0 when inactive). */
export function strengthBonus(state: GameState): number {
  return hasEffect(state, "strength") ? EFFECT_STRENGTH_BONUS : 0;
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
export function tickStatusEffects(state: GameState, dt: number, deps: StatusEffectDeps): void {
  for (const [id, remaining] of state.effects) {
    const next = remaining - dt;
    if (next <= 0) {
      state.effects.delete(id);
      deps.emit({ type: "effectExpired", effect: id });
    } else {
      state.effects.set(id, next);
    }
  }

  // Regeneration: heal on an independent accumulator, ignoring the hunger gate.
  if (hasEffect(state, "regeneration")) {
    state.timers.effectRegenTimer += dt;
    while (state.timers.effectRegenTimer >= EFFECT_REGEN_INTERVAL) {
      state.timers.effectRegenTimer -= EFFECT_REGEN_INTERVAL;
      if (state.hearts < MAX_HEARTS) state.hearts = Math.min(MAX_HEARTS, state.hearts + EFFECT_REGEN_HP);
    }
  } else {
    state.timers.effectRegenTimer = 0;
  }

  // Poison: never-lethal damage over time (the deps wrapper floors at half a heart).
  if (hasEffect(state, "poison")) {
    state.timers.effectPoisonTimer += dt;
    while (state.timers.effectPoisonTimer >= POISON_INTERVAL) {
      state.timers.effectPoisonTimer -= POISON_INTERVAL;
      deps.applyPoisonDamage(POISON_HP);
    }
  } else {
    state.timers.effectPoisonTimer = 0;
  }
}
