import {
  HEALTH_REGEN_INTERVAL_SECONDS,
  JUMPS_PER_HUNGER,
  EYE_HEIGHT,
  LAVA_BURN_SECONDS,
  LAVA_DAMAGE_HP,
  LAVA_DAMAGE_INTERVAL_SECONDS,
  MAX_HUNGER,
  MAX_HEARTS,
  MAX_OXYGEN,
  OXYGEN_DROWN_HP,
  OXYGEN_DROWN_INTERVAL_SECONDS,
  OXYGEN_HOLD_SECONDS,
  OXYGEN_REFILL_SECONDS,
  PLAYER_HEIGHT,
  REGEN_MIN_HUNGER,
  SPRINT_BLOCKS_PER_HUNGER,
  STARVATION_HP,
  STARVATION_INTERVAL_SECONDS,
  WATER_DAMAGE_DELAY_SECONDS,
  WATER_DAMAGE_HP,
  WATER_DAMAGE_INTERVAL_SECONDS,
  WALK_BLOCKS_PER_HUNGER
} from "@/lib/game/config";
import { BlockId } from "@/lib/world";
import { takesDamage } from "@/lib/game/gameModes";
import { regenIntervalScale, starves, starvationFloorHp } from "@/lib/game/difficulties";
import type { GameState } from "../state";
import type { MoveTickResult } from "./playerMotion";

/** Movement speed multiplier from the hunger level, with a small full-hunger bonus. */
export function speedScaleFromHunger(hunger: number): number {
  const ratio = Math.max(0, Math.min(1, hunger / MAX_HUNGER));
  return 0.62 + ratio * 0.38 + (ratio >= 0.99 ? 0.08 : 0);
}

/** Drains hunger from accumulated sprint/walk distance and jumps. Creative/Spectator never hunger. */
export function tickHungerDrain(state: GameState, move: MoveTickResult): void {
  if (!takesDamage(state.gameMode)) return;
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

/**
 * Regenerates half a heart every interval while alive, hurt, and fed enough.
 * Creative/Spectator stay topped up. Difficulty scales the cadence — Peaceful
 * heals twice as fast (regenIntervalScale 0.5) as its build-in-peace mercy.
 */
export function tickHealthRegen(state: GameState, dt: number): void {
  if (!takesDamage(state.gameMode)) {
    state.hearts = MAX_HEARTS;
    state.timers.regenTimer = 0;
    return;
  }
  if (!state.isDead && state.hearts < MAX_HEARTS && state.hunger >= REGEN_MIN_HUNGER) {
    const interval = HEALTH_REGEN_INTERVAL_SECONDS * regenIntervalScale(state.difficulty);
    state.timers.regenTimer += dt;
    if (state.timers.regenTimer >= interval) {
      state.hearts = Math.min(MAX_HEARTS, state.hearts + 1);
      state.timers.regenTimer = 0;
    }
  } else {
    state.timers.regenTimer = 0;
  }
}

/**
 * Starvation. While hunger sits at 0 the player loses STARVATION_HP every
 * interval, down to a difficulty-scaled floor: Easy stops at 10 HP, Normal at
 * 1 HP (half a heart), Hard goes all the way to 0 — a kill. Peaceful never
 * starves, and Creative/Spectator can't (their hunger is pinned full anyway).
 * Mirrors poison's floored chip-damage, but keyed on hunger == 0 rather than a
 * timed effect: Easy/Normal route through `applyFloored` (never lethal), Hard
 * (floor 0) through `applyLethal`, which can deliver the killing blow.
 */
export function tickStarvation(
  state: GameState,
  dt: number,
  applyFloored: (amount: number, floorHp: number) => void,
  applyLethal: (amount: number) => void
): void {
  if (!takesDamage(state.gameMode) || !starves(state.difficulty) || state.isDead || state.hunger > 0) {
    state.timers.starvationTimer = 0;
    return;
  }
  const floor = starvationFloorHp(state.difficulty);
  state.timers.starvationTimer += dt;
  while (state.timers.starvationTimer >= STARVATION_INTERVAL_SECONDS && !state.isDead) {
    state.timers.starvationTimer -= STARVATION_INTERVAL_SECONDS;
    if (floor <= 0) applyLethal(STARVATION_HP);
    else applyFloored(STARVATION_HP, floor);
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

/**
 * Burns the player on lava contact. Unlike water there is no grace period —
 * touching lava (standing on it or wading into it) deals armor-bypassing damage
 * at once and keeps burning for LAVA_BURN_SECONDS after escaping. Lava is solid,
 * so "contact" means the block at the feet, just under them, or at body height.
 */
export function tickLavaExposure(state: GameState, dt: number, applyDamage: (amount: number) => void, fireImmune = false): void {
  const { player, timers, world } = state;
  // Fire Resistance fully negates lava burn — no damage, no lingering burn timer.
  if (fireImmune) {
    timers.lavaBurnTimer = 0;
    timers.lavaDamageTimer = 0;
    return;
  }
  const x = Math.floor(player.position.x);
  const z = Math.floor(player.position.z);
  const py = player.position.y;
  const touching =
    world.get(x, Math.floor(py - 0.1), z) === BlockId.Lava || // the block underfoot (standing on lava)
    world.get(x, Math.floor(py), z) === BlockId.Lava || // the feet cell (wading in)
    world.get(x, Math.floor(py + PLAYER_HEIGHT * 0.5), z) === BlockId.Lava; // body height

  if (touching) {
    // First touch fires a hit immediately (no half-second of free standing).
    if (timers.lavaBurnTimer <= 0) timers.lavaDamageTimer = LAVA_DAMAGE_INTERVAL_SECONDS;
    timers.lavaBurnTimer = LAVA_BURN_SECONDS;
  }

  if (timers.lavaBurnTimer <= 0) {
    timers.lavaDamageTimer = 0;
    return;
  }
  timers.lavaBurnTimer = Math.max(0, timers.lavaBurnTimer - dt);
  timers.lavaDamageTimer += dt;
  while (timers.lavaDamageTimer >= LAVA_DAMAGE_INTERVAL_SECONDS && !state.isDead) {
    timers.lavaDamageTimer -= LAVA_DAMAGE_INTERVAL_SECONDS;
    applyDamage(LAVA_DAMAGE_HP);
  }
}

/**
 * Drowning. While the head (eye-height cell) is underwater the breath meter
 * drains over OXYGEN_HOLD_SECONDS; once empty, drowning deals armor-bypassing
 * damage every interval. Surfacing refills the meter quickly. Keyed on the head,
 * so wading chest-deep never drowns you — distinct from the body-keyed 60s
 * water-exposure timer, which still runs in parallel.
 */
export function tickOxygen(state: GameState, dt: number, applyDamage: (amount: number) => void, waterBreathing = false): void {
  const { player, timers, world } = state;
  // Creative/Spectator never drown — keep the lungs full so the bubble bar hides.
  if (!takesDamage(state.gameMode)) {
    state.oxygen = MAX_OXYGEN;
    timers.drownTimer = 0;
    return;
  }
  // Water Breathing keeps the lungs full and immune to drowning.
  if (waterBreathing) {
    state.oxygen = MAX_OXYGEN;
    timers.drownTimer = 0;
    return;
  }
  const x = Math.floor(player.position.x);
  const headY = Math.floor(player.position.y + EYE_HEIGHT);
  const z = Math.floor(player.position.z);

  if (world.get(x, headY, z) === BlockId.Water) {
    state.oxygen = Math.max(0, state.oxygen - (MAX_OXYGEN / OXYGEN_HOLD_SECONDS) * dt);
    if (state.oxygen > 0) {
      timers.drownTimer = 0;
      return;
    }
    timers.drownTimer += dt;
    while (timers.drownTimer >= OXYGEN_DROWN_INTERVAL_SECONDS && !state.isDead) {
      timers.drownTimer -= OXYGEN_DROWN_INTERVAL_SECONDS;
      applyDamage(OXYGEN_DROWN_HP);
    }
    return;
  }

  state.oxygen = Math.min(MAX_OXYGEN, state.oxygen + (MAX_OXYGEN / OXYGEN_REFILL_SECONDS) * dt);
  timers.drownTimer = 0;
}

/** Restores hunger by a food's value when it is eaten, clamped to the max. */
export function restoreHunger(hunger: number, amount: number): number {
  return Math.min(MAX_HUNGER, hunger + amount);
}
