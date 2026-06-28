import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
  EFFECT_HASTE_MULTIPLIER,
  EFFECT_JUMP_BOOST_VELOCITY,
  EFFECT_REGEN_INTERVAL,
  EFFECT_RESISTANCE_MULTIPLIER,
  EFFECT_SPEED_MULTIPLIER,
  EFFECT_STRENGTH_BONUS,
  MAX_HEARTS,
  MAX_OXYGEN,
  POISON_FLOOR_HP,
  POISON_INTERVAL
} from "@/lib/game/config";
import { BlockId } from "@/lib/world";
import { createEmptyArmorEquipment } from "@/lib/game/items";
import { createTimers, type GameEvent, type GameState } from "@/lib/game/engine/state";
import {
  addEffect,
  clearEffects,
  effectRemaining,
  hasEffect,
  hasteMultiplier,
  jumpBoostBonus,
  resistanceMultiplier,
  speedMultiplier,
  strengthBonus,
  tickStatusEffects,
  type StatusEffectDeps
} from "@/lib/game/engine/systems/statusEffects";
import { applyDamageWithArmor, applyNonLethalDamage, applyUnmitigatedDamage } from "@/lib/game/engine/systems/playerLife";
import { tickLavaExposure, tickOxygen } from "@/lib/game/engine/systems/playerStats";
import type { EffectId } from "@/lib/game/types";

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    player: { position: new THREE.Vector3(0, 64, 0), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true },
    gameMode: "survival",
    hearts: MAX_HEARTS,
    hunger: 20,
    oxygen: MAX_OXYGEN,
    isDead: false,
    effects: new Map<EffectId, number>(),
    timers: createTimers(),
    ...overrides
  } as unknown as GameState;
}

/** A world stub whose every cell is `block` — enough for the lava/oxygen gates. */
function uniformWorld(block: BlockId): GameState["world"] {
  return { get: () => block } as unknown as GameState["world"];
}

function deps(overrides: Partial<StatusEffectDeps> = {}): StatusEffectDeps {
  return { applyPoisonDamage: () => {}, emit: () => {}, ...overrides };
}

describe("addEffect / hasEffect / effectRemaining", () => {
  test("adds an effect and reports its remaining time", () => {
    const state = makeState();
    addEffect(state, "speed", 30);
    expect(hasEffect(state, "speed")).toBe(true);
    expect(effectRemaining(state, "speed")).toBe(30);
    expect(hasEffect(state, "strength")).toBe(false);
  });

  test("refresh keeps the longer of the two durations", () => {
    const state = makeState();
    addEffect(state, "speed", 30);
    addEffect(state, "speed", 10); // shorter — ignored
    expect(effectRemaining(state, "speed")).toBe(30);
    addEffect(state, "speed", 45); // longer — wins
    expect(effectRemaining(state, "speed")).toBe(45);
  });
});

describe("modifiers", () => {
  test("speedMultiplier and strengthBonus reflect active effects", () => {
    const state = makeState();
    expect(speedMultiplier(state)).toBe(1);
    expect(strengthBonus(state)).toBe(0);
    addEffect(state, "speed", 10);
    addEffect(state, "strength", 10);
    expect(speedMultiplier(state)).toBe(EFFECT_SPEED_MULTIPLIER);
    expect(strengthBonus(state)).toBe(EFFECT_STRENGTH_BONUS);
  });

  test("haste, resistance, and jump-boost modifiers reflect active effects", () => {
    const state = makeState();
    expect(hasteMultiplier(state)).toBe(1);
    expect(resistanceMultiplier(state)).toBe(1);
    expect(jumpBoostBonus(state)).toBe(0);
    addEffect(state, "haste", 10);
    addEffect(state, "resistance", 10);
    addEffect(state, "jump_boost", 10);
    expect(hasteMultiplier(state)).toBe(EFFECT_HASTE_MULTIPLIER);
    expect(resistanceMultiplier(state)).toBe(EFFECT_RESISTANCE_MULTIPLIER);
    expect(jumpBoostBonus(state)).toBe(EFFECT_JUMP_BOOST_VELOCITY);
  });
});

describe("Resistance scope", () => {
  test("reduces armor-mitigated combat damage but leaves unmitigated hazards alone", () => {
    const plain = makeState({ hearts: 20, equippedArmor: createEmptyArmorEquipment() });
    const resisted = makeState({ hearts: 20, equippedArmor: createEmptyArmorEquipment() });
    addEffect(resisted, "resistance", 60);
    applyDamageWithArmor(plain, 10);
    applyDamageWithArmor(resisted, 10);
    expect(20 - resisted.hearts).toBeLessThan(20 - plain.hearts); // Resistance softened the combat hit

    // Lava/void/starvation flow through applyUnmitigatedDamage, which Resistance must not touch.
    const hazardPlain = makeState({ hearts: 20 });
    const hazardResisted = makeState({ hearts: 20 });
    addEffect(hazardResisted, "resistance", 60);
    applyUnmitigatedDamage(hazardPlain, 6);
    applyUnmitigatedDamage(hazardResisted, 6);
    expect(hazardResisted.hearts).toBe(hazardPlain.hearts);
  });
});

describe("tickStatusEffects", () => {
  test("counts effects down and emits effectExpired at zero", () => {
    const state = makeState();
    addEffect(state, "speed", 1.0);
    const events: GameEvent[] = [];
    const d = deps({ emit: (e) => events.push(e) });

    tickStatusEffects(state, 0.4, d);
    expect(effectRemaining(state, "speed")).toBeCloseTo(0.6, 5);
    tickStatusEffects(state, 0.4, d);
    tickStatusEffects(state, 0.4, d); // 1.2s total → expired
    expect(hasEffect(state, "speed")).toBe(false);
    expect(events).toEqual([{ type: "effectExpired", effect: "speed" }]);
  });

  test("regeneration heals on its own cadence even at zero hunger", () => {
    const state = makeState({ hearts: 10, hunger: 0 });
    addEffect(state, "regeneration", 100);
    tickStatusEffects(state, EFFECT_REGEN_INTERVAL, deps());
    expect(state.hearts).toBe(11); // healed despite hunger gating regen off
  });

  test("regeneration never exceeds the heart cap", () => {
    const state = makeState({ hearts: MAX_HEARTS, hunger: 0 });
    addEffect(state, "regeneration", 100);
    for (let i = 0; i < 5; i += 1) tickStatusEffects(state, EFFECT_REGEN_INTERVAL, deps());
    expect(state.hearts).toBe(MAX_HEARTS);
  });

  test("poison chips hearts down but floors at half a heart", () => {
    const state = makeState({ hearts: 3 });
    addEffect(state, "poison", 100);
    const d = deps({ applyPoisonDamage: (amount) => applyNonLethalDamage(state, amount, POISON_FLOOR_HP) });
    for (let i = 0; i < 20; i += 1) tickStatusEffects(state, POISON_INTERVAL, d);
    expect(state.hearts).toBe(POISON_FLOOR_HP); // chipped to the floor, never below
  });
});

describe("clearEffects", () => {
  test("drops every effect and resets the accumulators", () => {
    const state = makeState();
    addEffect(state, "speed", 30);
    addEffect(state, "poison", 8);
    state.timers.effectRegenTimer = 0.7;
    state.timers.effectPoisonTimer = 0.9;
    clearEffects(state);
    expect(state.effects.size).toBe(0);
    expect(state.timers.effectRegenTimer).toBe(0);
    expect(state.timers.effectPoisonTimer).toBe(0);
  });
});

describe("applyNonLethalDamage", () => {
  test("floors hearts and never returns a kill", () => {
    const state = makeState({ hearts: 2 });
    expect(applyNonLethalDamage(state, 5, 1)).toBe(true);
    expect(state.hearts).toBe(1);
    expect(applyNonLethalDamage(state, 5, 1)).toBe(false); // already at the floor
    expect(state.hearts).toBe(1);
    expect(state.isDead).toBe(false); // never set lethal in this helper
  });
});

describe("environmental gates", () => {
  test("fire resistance negates lava burn", () => {
    const state = makeState({ world: uniformWorld(BlockId.Lava) });
    let damage = 0;
    tickLavaExposure(state, 0.5, (a) => (damage += a), true);
    expect(damage).toBe(0);
    tickLavaExposure(state, 0.5, (a) => (damage += a), false);
    expect(damage).toBeGreaterThan(0);
  });

  test("water breathing keeps the lungs full and immune to drowning", () => {
    const state = makeState({ world: uniformWorld(BlockId.Water), oxygen: 0 });
    let damage = 0;
    tickOxygen(state, 1, (a) => (damage += a), true);
    expect(damage).toBe(0);
    expect(state.oxygen).toBe(MAX_OXYGEN);
    // Without the effect, an empty meter underwater drowns.
    state.oxygen = 0;
    tickOxygen(state, 1, (a) => (damage += a), false);
    expect(damage).toBeGreaterThan(0);
  });
});
