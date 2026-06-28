import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
  BOW_ARROW_DAMAGE,
  BOW_COOLDOWN_SECONDS,
  BOW_KNOCKBACK,
  EYE_HEIGHT,
  KNOCKBACK_PER_LEVEL,
  MELEE_KNOCKBACK_IMPULSE,
  POWER_DAMAGE_PER_LEVEL,
  PUNCH_KNOCKBACK_PER_LEVEL
} from "@/lib/game/config";
import { createEmptySlot, createSlot } from "@/lib/game/items";
import { applyEnchant } from "@/lib/game/enchantments";
import { countsById } from "@/lib/game/inventory";
import { createTimers, type GameEvent, type GameState, type MobState } from "@/lib/game/engine/state";
import { isBow, tryAttackMob, tryFireBow } from "@/lib/game/engine/systems/combat";
import type { InventorySlot } from "@/lib/game/types";

function makeState(slots: InventorySlot[], selectedSlot = 0): GameState {
  return {
    player: { position: new THREE.Vector3(0, 64, 0), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true },
    inventory: slots,
    selectedSlot,
    mobs: [],
    timers: createTimers(),
    projectiles: [],
    nextProjectileId: 1
  } as unknown as GameState;
}

/** A zombie at eye height two blocks ahead (down -Z), directly in the aim cone. */
function mobInFront(): MobState {
  return {
    kind: "zombie",
    hp: 100,
    position: new THREE.Vector3(0, 64 + EYE_HEIGHT, -2),
    direction: new THREE.Vector3()
  } as unknown as MobState;
}

function inventory(items: Array<[string, number]>): InventorySlot[] {
  const slots = Array.from({ length: 9 }, () => createEmptySlot());
  items.forEach(([id, count], i) => {
    slots[i] = createSlot(id, count);
  });
  return slots;
}

describe("isBow", () => {
  test("recognizes a held bow and rejects other items", () => {
    expect(isBow(createSlot("bow", 1))).toBe(true);
    expect(isBow(createSlot("diamond_sword", 1))).toBe(false);
    expect(isBow(createEmptySlot())).toBe(false);
    expect(isBow(undefined)).toBe(false);
  });
});

describe("tryFireBow", () => {
  test("fires an arrow, consumes ammo + durability, and arms the cooldown", () => {
    const state = makeState(
      inventory([
        ["bow", 1],
        ["arrow", 5]
      ])
    );
    const events: GameEvent[] = [];
    const fired = tryFireBow(state, (e) => events.push(e));

    expect(fired).toBe(true);
    expect(state.projectiles).toHaveLength(1);
    expect(state.projectiles[0].fromPlayer).toBe(true);
    expect(countsById(state.inventory).get("arrow")).toBe(4);
    expect(state.inventory[0].durability).toBe(199); // 200 max − 1 per shot
    expect(state.timers.bowCooldownTimer).toBeCloseTo(BOW_COOLDOWN_SECONDS, 5);
    expect(events.some((e) => e.type === "bowFired")).toBe(true);
  });

  test("refuses to fire while on cooldown", () => {
    const state = makeState(
      inventory([
        ["bow", 1],
        ["arrow", 5]
      ])
    );
    expect(tryFireBow(state, () => {})).toBe(true);
    const after = state.projectiles.length;
    expect(tryFireBow(state, () => {})).toBe(false);
    expect(state.projectiles).toHaveLength(after); // no second arrow
  });

  test("refuses to fire with no arrows", () => {
    const state = makeState(inventory([["bow", 1]]));
    expect(tryFireBow(state, () => {})).toBe(false);
    expect(state.projectiles).toHaveLength(0);
  });

  test("refuses to fire when the held item is not a bow", () => {
    const state = makeState(
      inventory([
        ["diamond_sword", 1],
        ["arrow", 5]
      ])
    );
    expect(tryFireBow(state, () => {})).toBe(false);
    expect(state.projectiles).toHaveLength(0);
  });

  test("Power and Punch on the bow raise the fired arrow's damage and knockback", () => {
    const slots = inventory([
      ["bow", 1],
      ["arrow", 5]
    ]);
    // Power 2, Punch 1 on the held bow.
    slots[0] = applyEnchant(applyEnchant(applyEnchant(slots[0], "power"), "power"), "punch");
    const state = makeState(slots);
    expect(tryFireBow(state, () => {})).toBe(true);
    const arrow = state.projectiles[0];
    expect(arrow.damage).toBe(BOW_ARROW_DAMAGE + 2 * POWER_DAMAGE_PER_LEVEL);
    expect(arrow.knockback).toBeCloseTo(BOW_KNOCKBACK + 1 * PUNCH_KNOCKBACK_PER_LEVEL, 5);
  });
});

describe("tryAttackMob knockback", () => {
  test("a plain hit shoves by the base impulse; Knockback adds to it", () => {
    const plain = makeState(inventory([["diamond_sword", 1]]));
    plain.mobs = [mobInFront()];
    const enchanted = makeState(inventory([["diamond_sword", 1]]));
    enchanted.mobs = [mobInFront()];

    expect(tryAttackMob(plain, 5, () => {}, 5, 0)).toBe("zombie");
    expect(tryAttackMob(enchanted, 5, () => {}, 5, 2 * KNOCKBACK_PER_LEVEL)).toBe("zombie");

    // The mob starts at z = -2 and is shoved further down -Z; the base impulse is exact.
    expect(plain.mobs[0].position.z).toBeCloseTo(-2 - MELEE_KNOCKBACK_IMPULSE, 5);
    // More knockback => pushed further (more negative z).
    expect(enchanted.mobs[0].position.z).toBeLessThan(plain.mobs[0].position.z);
    expect(enchanted.mobs[0].position.z).toBeCloseTo(-2 - (MELEE_KNOCKBACK_IMPULSE + 2 * KNOCKBACK_PER_LEVEL), 5);
  });

  test("a lethal melee hit forwards the killing weapon's Looting level to the kill callback", () => {
    const state = makeState(inventory([["diamond_sword", 1]]));
    const mob = mobInFront();
    mob.hp = 1; // dies in one hit
    state.mobs = [mob];
    let received = -1;
    tryAttackMob(state, 5, (_index, looting = 0) => (received = looting), 5, 0, 3);
    expect(received).toBe(3); // Looting from the held weapon, not live selected-slot state at death
  });
});
