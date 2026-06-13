import {
  HEALTH_REGEN_INTERVAL_SECONDS,
  JUMPS_PER_HUNGER,
  MAX_HUNGER,
  MAX_HEARTS,
  PLAYER_HEIGHT,
  REGEN_MIN_HUNGER,
  SPRINT_BLOCKS_PER_HUNGER,
  WATER_DAMAGE_DELAY_SECONDS,
  WATER_DAMAGE_HP,
  WATER_DAMAGE_INTERVAL_SECONDS,
  WALK_BLOCKS_PER_HUNGER
} from "@/lib/game/config";
import { BlockId } from "@/lib/world";
import type { GameState } from "../state";
import type { MoveTickResult } from "./playerMotion";

/** Movement speed multiplier from the hunger level, with a small full-hunger bonus. */
export function speedScaleFromHunger(hunger: number): number {
  const ratio = Math.max(0, Math.min(1, hunger / MAX_HUNGER));
  return 0.62 + ratio * 0.38 + (ratio >= 0.99 ? 0.08 : 0);
}

/** Drains hunger from accumulated sprint/walk distance and jumps. */
export function tickHungerDrain(state: GameState, move: MoveTickResult): void {
  const { timers } = state;
  let drain = 0;

  if (move.didSprint) {
    timers.sprintDistanceBudget += move.horizontalDistance;
    while (timers.sprintDistanceBudget >= SPRINT_BLOCKS_PER_HUNGER) {
      timers.sprintDistanceBudget -= SPRINT_BLOCKS_PER_HUNGER;
      drain += 1;
    }
  } else if (move.didWalk) {
    timers.walkDistanceBudget += move.horizontalDistance;
    while (timers.walkDistanceBudget >= WALK_BLOCKS_PER_HUNGER) {
      timers.walkDistanceBudget -= WALK_BLOCKS_PER_HUNGER;
      drain += 1;
    }
  }
  if (move.didJump) {
    timers.jumpBudget += 1;
    while (timers.jumpBudget >= JUMPS_PER_HUNGER) {
      timers.jumpBudget -= JUMPS_PER_HUNGER;
      drain += 1;
    }
  }

  if (drain > 0) state.hunger = Math.max(0, state.hunger - drain);
}

/** Regenerates half a heart every interval while alive, hurt, and fed enough. */
export function tickHealthRegen(state: GameState, dt: number): void {
  if (!state.isDead && state.hearts < MAX_HEARTS && state.hunger >= REGEN_MIN_HUNGER) {
    state.timers.regenTimer += dt;
    if (state.timers.regenTimer >= HEALTH_REGEN_INTERVAL_SECONDS) {
      state.hearts = Math.min(MAX_HEARTS, state.hearts + 1);
      state.timers.regenTimer = 0;
    }
  } else {
    state.timers.regenTimer = 0;
  }
}

/** Damages a continuously immersed player after one minute; leaving water fully resets the clock. */
export function tickWaterExposure(state: GameState, dt: number, applyDamage: (amount: number) => void): void {
  const { player, timers, world } = state;
  const x = Math.floor(player.position.x);
  const y = Math.floor(player.position.y + PLAYER_HEIGHT * 0.5);
  const z = Math.floor(player.position.z);
  if (world.get(x, y, z) !== BlockId.Water) {
    timers.waterExposureTimer = 0;
    timers.waterDamageTimer = 0;
    return;
  }

  timers.waterExposureTimer += dt;
  if (timers.waterExposureTimer <= WATER_DAMAGE_DELAY_SECONDS) return;

  timers.waterDamageTimer += dt;
  while (timers.waterDamageTimer >= WATER_DAMAGE_INTERVAL_SECONDS && !state.isDead) {
    timers.waterDamageTimer -= WATER_DAMAGE_INTERVAL_SECONDS;
    applyDamage(WATER_DAMAGE_HP);
  }
}

/** Restores hunger by a food's value when it is eaten, clamped to the max. */
export function restoreHunger(hunger: number, amount: number): number {
  return Math.min(MAX_HUNGER, hunger + amount);
}
