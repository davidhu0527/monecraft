import {
  FOOD_ENERGY,
  HEALTH_REGEN_INTERVAL_SECONDS,
  JUMPS_PER_ENERGY,
  MAX_ENERGY,
  MAX_HEARTS,
  SPRINT_BLOCKS_PER_ENERGY,
  WALK_BLOCKS_PER_ENERGY
} from "@/lib/game/config";
import type { GameState } from "../state";
import type { MoveTickResult } from "./playerMotion";

/** Movement speed multiplier from the energy level, with a small full-energy bonus. */
export function speedScaleFromEnergy(energy: number): number {
  const ratio = Math.max(0, Math.min(1, energy / MAX_ENERGY));
  return 0.62 + ratio * 0.38 + (ratio >= 0.99 ? 0.08 : 0);
}

/** Drains energy from accumulated sprint/walk distance and jumps. */
export function tickEnergyDrain(state: GameState, move: MoveTickResult): void {
  const { timers } = state;
  let drain = 0;

  if (move.didSprint) {
    timers.sprintDistanceBudget += move.horizontalDistance;
    while (timers.sprintDistanceBudget >= SPRINT_BLOCKS_PER_ENERGY) {
      timers.sprintDistanceBudget -= SPRINT_BLOCKS_PER_ENERGY;
      drain += 1;
    }
  } else if (move.didWalk) {
    timers.walkDistanceBudget += move.horizontalDistance;
    while (timers.walkDistanceBudget >= WALK_BLOCKS_PER_ENERGY) {
      timers.walkDistanceBudget -= WALK_BLOCKS_PER_ENERGY;
      drain += 1;
    }
  }
  if (move.didJump) {
    timers.jumpBudget += 1;
    while (timers.jumpBudget >= JUMPS_PER_ENERGY) {
      timers.jumpBudget -= JUMPS_PER_ENERGY;
      drain += 1;
    }
  }

  if (drain > 0) state.energy = Math.max(0, state.energy - drain);
}

/** Regenerates one heart every interval while alive and hurt. */
export function tickHealthRegen(state: GameState, dt: number): void {
  if (!state.isDead && state.hearts < MAX_HEARTS) {
    state.timers.regenTimer += dt;
    if (state.timers.regenTimer >= HEALTH_REGEN_INTERVAL_SECONDS) {
      state.hearts = Math.min(MAX_HEARTS, state.hearts + 1);
      state.timers.regenTimer = 0;
    }
  } else {
    state.timers.regenTimer = 0;
  }
}

/** Restores energy when food is eaten. */
export function eatEnergy(energy: number): number {
  return Math.min(MAX_ENERGY, energy + FOOD_ENERGY);
}
