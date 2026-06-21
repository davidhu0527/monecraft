import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { HEALTH_REGEN_INTERVAL_SECONDS, MAX_HEARTS, MAX_OXYGEN, STARVATION_INTERVAL_SECONDS } from "@/lib/game/config";
import { createTimers, type GameState } from "@/lib/game/engine/state";
import { tickHealthRegen, tickStarvation } from "@/lib/game/engine/systems/playerStats";
import { applyNonLethalDamage, applyUnmitigatedDamage } from "@/lib/game/engine/systems/playerLife";
import type { Difficulty } from "@/lib/game/difficulties";
import type { GameMode } from "@/lib/game/gameModes";
import type { EffectId } from "@/lib/game/types";

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    player: { position: new THREE.Vector3(0, 64, 0), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true },
    gameMode: "survival" as GameMode,
    difficulty: "normal" as Difficulty,
    hearts: MAX_HEARTS,
    hunger: 20,
    oxygen: MAX_OXYGEN,
    isDead: false,
    effects: new Map<EffectId, number>(),
    timers: createTimers(),
    ...overrides
  } as unknown as GameState;
}

// The same wiring the engine uses: Easy/Normal floor via applyNonLethalDamage,
// Hard (floor 0) kills via applyUnmitigatedDamage.
const applyFloored = (state: GameState) => (amount: number, floorHp: number) => void applyNonLethalDamage(state, amount, floorHp);
const applyLethal = (state: GameState) => (amount: number) => void applyUnmitigatedDamage(state, amount);

/** Advances starvation by `seconds` of game time in one call. */
function starve(state: GameState, seconds: number): void {
  tickStarvation(state, seconds, applyFloored(state), applyLethal(state));
}

describe("tickStarvation", () => {
  test("Peaceful never starves and keeps the timer at rest", () => {
    const state = makeState({ difficulty: "peaceful", hunger: 0 });
    starve(state, STARVATION_INTERVAL_SECONDS * 10);
    expect(state.hearts).toBe(MAX_HEARTS);
    expect(state.timers.starvationTimer).toBe(0);
  });

  test("Easy chips down to a 10 HP floor and stops", () => {
    const state = makeState({ difficulty: "easy", hunger: 0 });
    starve(state, STARVATION_INTERVAL_SECONDS * 100); // far past the floor
    expect(state.hearts).toBe(10);
    expect(state.isDead).toBe(false);
  });

  test("Normal chips down to a half-heart (1 HP) floor and stops", () => {
    const state = makeState({ difficulty: "normal", hunger: 0 });
    starve(state, STARVATION_INTERVAL_SECONDS * 100);
    expect(state.hearts).toBe(1);
    expect(state.isDead).toBe(false);
  });

  test("Hard starves all the way to death", () => {
    const state = makeState({ difficulty: "hard", hunger: 0 });
    starve(state, STARVATION_INTERVAL_SECONDS * 100);
    expect(state.hearts).toBe(0);
    expect(state.isDead).toBe(true);
  });

  test("does nothing while there is still hunger, and rests the timer", () => {
    const state = makeState({ difficulty: "hard", hunger: 5 });
    state.timers.starvationTimer = 3;
    starve(state, STARVATION_INTERVAL_SECONDS);
    expect(state.hearts).toBe(MAX_HEARTS);
    expect(state.timers.starvationTimer).toBe(0);
  });

  test("Creative never starves even at zero hunger", () => {
    const state = makeState({ difficulty: "hard", gameMode: "creative", hunger: 0 });
    starve(state, STARVATION_INTERVAL_SECONDS * 100);
    expect(state.hearts).toBe(MAX_HEARTS);
  });

  test("a dead player is left alone", () => {
    const state = makeState({ difficulty: "hard", hunger: 0, isDead: true, hearts: 6 });
    starve(state, STARVATION_INTERVAL_SECONDS * 5);
    expect(state.hearts).toBe(6);
  });

  test("a sub-interval slice does not bite, but crossing the interval does", () => {
    const state = makeState({ difficulty: "normal", hunger: 0 });
    starve(state, STARVATION_INTERVAL_SECONDS - 0.1); // not yet
    expect(state.hearts).toBe(MAX_HEARTS);
    starve(state, 0.1); // now exactly at one interval
    expect(state.hearts).toBe(MAX_HEARTS - 1);
  });

  test("one big slice can land several ticks at once", () => {
    const state = makeState({ difficulty: "normal", hunger: 0 });
    starve(state, STARVATION_INTERVAL_SECONDS * 3 + 0.5);
    expect(state.hearts).toBe(MAX_HEARTS - 3);
  });
});

describe("tickHealthRegen difficulty scaling", () => {
  test("Peaceful heals in half the time of the baseline interval", () => {
    const peaceful = makeState({ difficulty: "peaceful", hearts: 10, hunger: 20 });
    tickHealthRegen(peaceful, HEALTH_REGEN_INTERVAL_SECONDS * 0.5); // Peaceful's faster cadence
    expect(peaceful.hearts).toBe(11);

    // Normal needs the full interval — half of it isn't enough.
    const normal = makeState({ difficulty: "normal", hearts: 10, hunger: 20 });
    tickHealthRegen(normal, HEALTH_REGEN_INTERVAL_SECONDS * 0.5);
    expect(normal.hearts).toBe(10);
  });
});
