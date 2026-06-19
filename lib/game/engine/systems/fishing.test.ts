import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BlockId, VoxelWorld } from "@/lib/world";
import { FISHING_BITE_WINDOW_SECONDS } from "@/lib/game/config";
import { countsById } from "@/lib/game/inventory";
import { createEmptySlot, createSlot } from "@/lib/game/items";
import type { GameEvent, GameState } from "../state";
import { tickFishing, tryFish } from "./fishing";

/**
 * Minimal GameState with just the fields the fishing system reads. A water surface
 * sits at (8,7,5); the player at (8.5,6,8.5) looking -Z aims straight at it.
 */
function makeState(): GameState {
  const world = new VoxelWorld(16, 16, 16, 1);
  world.set(8, 7, 5, BlockId.Water); // air above by default → a castable surface
  const inventory = Array.from({ length: 9 }, () => createEmptySlot());
  inventory[0] = createSlot("fishing_rod", 1);
  return {
    world,
    inventory,
    selectedSlot: 0,
    fishing: null,
    isDead: false,
    player: { position: new THREE.Vector3(8.5, 6, 8.5), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true }
  } as unknown as GameState;
}

function collector(): { emit: (e: GameEvent) => void; events: GameEvent[] } {
  const events: GameEvent[] = [];
  return { emit: (e) => events.push(e), events };
}

describe("fishing", () => {
  test("right-clicking the rod at water casts a bobber and emits fishingCast", () => {
    const state = makeState();
    const { emit, events } = collector();
    expect(tryFish(state, emit, () => 0.5)).toBe(true);
    expect(state.fishing).not.toBeNull();
    expect(state.fishing!.biting).toBe(false);
    // The cast event carries the bobber position (drives the splash particle).
    expect(events.find((e) => e.type === "fishingCast")).toMatchObject({
      x: state.fishing!.position.x,
      y: state.fishing!.position.y,
      z: state.fishing!.position.z
    });
  });

  test("aiming the rod away from water consumes the click but starts no cast", () => {
    const state = makeState();
    state.player.pitch = 1.4; // look up at the sky
    const { emit, events } = collector();
    expect(tryFish(state, emit, () => 0.5)).toBe(true);
    expect(state.fishing).toBeNull();
    expect(events.some((e) => e.type === "fishingCast")).toBe(false);
  });

  test("a non-rod item is left to the normal placement path", () => {
    const state = makeState();
    state.inventory[0] = createSlot("dirt", 10);
    const { emit } = collector();
    expect(tryFish(state, emit, () => 0.5)).toBe(false);
  });

  test("the bobber bites after the delay and emits fishingBite", () => {
    const state = makeState();
    tryFish(
      state,
      () => {},
      () => 0
    ); // timer = bite min
    const { emit, events } = collector();
    tickFishing(state, 5, () => 0, emit); // dt past the whole delay
    expect(state.fishing!.biting).toBe(true);
    expect(events.some((e) => e.type === "fishingBite")).toBe(true);
  });

  test("reeling during the bite window yields a catch and drains durability", () => {
    const state = makeState();
    state.fishing = { position: new THREE.Vector3(8.5, 8, 5.5), timer: 1, biting: true };
    const { emit, events } = collector();
    tryFish(state, emit, () => 0); // rng 0 → the common raw fish
    expect(countsById(state.inventory).get("raw_fish")).toBe(1);
    expect(state.inventory[0].durability).toBe(state.inventory[0].maxDurability! - 1);
    expect(state.fishing).toBeNull();
    expect(events.find((e) => e.type === "fishingCaught")).toMatchObject({ x: 8.5, y: 8, z: 5.5 });
  });

  test("reeling with no bite comes back empty", () => {
    const state = makeState();
    state.fishing = { position: new THREE.Vector3(8.5, 8, 5.5), timer: 2, biting: false };
    const { emit, events } = collector();
    tryFish(state, emit, () => 0);
    expect(countsById(state.inventory).get("raw_fish")).toBeUndefined();
    expect(state.inventory[0].durability).toBe(state.inventory[0].maxDurability!); // no wear on an empty reel
    expect(state.fishing).toBeNull();
    expect(events.some((e) => e.type === "fishingReeledEmpty")).toBe(true);
  });

  test("a missed bite window restarts the wait", () => {
    const state = makeState();
    state.fishing = { position: new THREE.Vector3(8.5, 8, 5.5), timer: 0.01, biting: true };
    tickFishing(
      state,
      1,
      () => 0,
      () => {}
    );
    expect(state.fishing).not.toBeNull();
    expect(state.fishing!.biting).toBe(false);
    expect(state.fishing!.timer).toBeGreaterThan(FISHING_BITE_WINDOW_SECONDS);
  });

  test("the cast cancels when the rod is unequipped", () => {
    const state = makeState();
    state.fishing = { position: new THREE.Vector3(8.5, 8, 5.5), timer: 2, biting: false };
    state.selectedSlot = 1; // empty slot
    tickFishing(
      state,
      0.1,
      () => 0,
      () => {}
    );
    expect(state.fishing).toBeNull();
  });

  test("the cast cancels when the targeted water drains", () => {
    const state = makeState();
    state.fishing = { position: new THREE.Vector3(8.5, 8, 5.5), timer: 2, biting: false };
    state.world.set(8, 7, 5, BlockId.Air); // the water under the bobber is gone
    tickFishing(
      state,
      0.1,
      () => 0,
      () => {}
    );
    expect(state.fishing).toBeNull();
  });

  test("the cast cancels when the player strays past the tether", () => {
    const state = makeState();
    state.fishing = { position: new THREE.Vector3(8.5, 8, 5.5), timer: 2, biting: false };
    state.player.position.set(8.5, 6, 60);
    tickFishing(
      state,
      0.1,
      () => 0,
      () => {}
    );
    expect(state.fishing).toBeNull();
  });
});
