import {
  FOOD_HUNGER,
  HEALTH_REGEN_INTERVAL_SECONDS,
  JUMPS_PER_HUNGER,
  MAX_HUNGER,
  MAX_HEARTS,
  SPRINT_BLOCKS_PER_HUNGER,
  WALK_BLOCKS_PER_HUNGER
} from "@/lib/game/config";
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

/** Restores hunger when food is eaten. */
export function restoreHunger(hunger: number): number {
  return Math.min(MAX_HUNGER, hunger + FOOD_HUNGER);
}
