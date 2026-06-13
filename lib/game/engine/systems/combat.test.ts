import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BOW_COOLDOWN_SECONDS } from "@/lib/game/config";
import { createEmptySlot, createSlot } from "@/lib/game/items";
import { countsById } from "@/lib/game/inventory";
import { createTimers, type GameEvent, type GameState } from "@/lib/game/engine/state";
import { isBow, tryFireBow } from "@/lib/game/engine/systems/combat";
import type { InventorySlot } from "@/lib/game/types";

function makeState(slots: InventorySlot[], selectedSlot = 0): GameState {
  return {
    player: { position: new THREE.Vector3(0, 64, 0), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true },
    inventory: slots,
    selectedSlot,
    timers: createTimers(),
    projectiles: [],
    nextProjectileId: 1
  } as unknown as GameState;
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
});
