import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BlockId, voxelRaycast } from "@/lib/world";
import { EYE_HEIGHT, MINE_REACH } from "@/lib/game/config";
import { createSlot } from "@/lib/game/items";
import { GameEngine } from "@/lib/game/engine/GameEngine";
import { lookDirection } from "@/lib/game/engine/systems/playerMotion";
import { applyDamageWithArmor } from "@/lib/game/engine/systems/playerLife";
import { pushMob } from "@/lib/game/engine/systems/spawnDirector";
import type { GameMode } from "@/lib/game/gameModes";
import type { FrameInput } from "@/lib/game/engine/state";

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeEngine(gameMode: GameMode): GameEngine {
  return new GameEngine({ seed: 1337, gameMode, rng: mulberry32(42), worldSize: { x: 64, y: 150, z: 64 } });
}

function input(overrides: Partial<{ keys: string[]; leftMouseHeld: boolean; pointerLocked: boolean }> = {}): FrameInput {
  return {
    keys: new Set(overrides.keys ?? []),
    capsActive: false,
    leftMouseHeld: overrides.leftMouseHeld ?? false,
    pointerLocked: overrides.pointerLocked ?? false
  };
}

describe("adventure", () => {
  test("takes damage like survival (not invulnerable)", () => {
    const e = makeEngine("adventure");
    const before = e.state.hearts;
    applyDamageWithArmor(e.state, 4);
    expect(e.state.hearts).toBe(before - 4);
  });

  test("can't fly", () => {
    const e = makeEngine("adventure");
    e.dispatch({ type: "toggleFlight" });
    expect(e.state.isFlying).toBe(false);
  });

  test("can't break a block", () => {
    const e = makeEngine("adventure");
    e.state.mobs = e.state.mobs.filter((mob) => !mob.hostile);
    const p = e.state.player;
    p.velocity.set(0, 0, 0);
    p.pitch = -Math.PI / 2 + 0.01;
    const origin = new THREE.Vector3(p.position.x, p.position.y + EYE_HEIGHT, p.position.z);
    const hit = voxelRaycast(e.state.world, origin, lookDirection(p.yaw, p.pitch, new THREE.Vector3()), MINE_REACH);
    expect(hit).not.toBeNull();
    const { x, y, z } = hit!.hit;
    for (let i = 0; i < 60; i += 1) e.step(1 / 60, input({ leftMouseHeld: true, pointerLocked: true }));
    expect(e.state.world.get(x, y, z)).not.toBe(BlockId.Air); // terrain untouched
  });

  test("can't place a block", () => {
    const e = makeEngine("adventure");
    const p = e.state.player;
    p.position.x = Math.floor(p.position.x) + 0.5;
    p.position.z = Math.floor(p.position.z) + 0.5;
    const px = Math.floor(p.position.x);
    const ey = Math.floor(p.position.y + EYE_HEIGHT);
    const pz = Math.floor(p.position.z);
    e.state.blockChanges.set(px, ey, pz, BlockId.Air);
    e.state.blockChanges.set(px + 1, ey, pz, BlockId.Air);
    e.state.blockChanges.set(px + 2, ey, pz, BlockId.Air);
    e.state.blockChanges.set(px + 3, ey, pz, BlockId.Stone);
    p.yaw = -Math.PI / 2;
    p.pitch = 0;
    e.state.selectedSlot = 0;
    e.state.inventory[0] = createSlot("dirt", 10);

    e.dispatch({ type: "placeBlock" });

    expect(e.state.world.get(px + 2, ey, pz)).toBe(BlockId.Air); // nothing placed
    expect(e.state.inventory[0].count).toBe(10); // stack untouched
  });

  test("combat is enabled (swing registers), unlike spectator", () => {
    const adventure = makeEngine("adventure");
    adventure.dispatch({ type: "attack" });
    expect(adventure.consumeEvents().some((event) => event.type === "attackSwung")).toBe(true);

    const spectator = makeEngine("spectator");
    spectator.dispatch({ type: "attack" });
    expect(spectator.consumeEvents().some((event) => event.type === "attackSwung")).toBe(false);
  });

  test("hostiles still hunt an adventure player", () => {
    const e = makeEngine("adventure");
    e.state.dayClock = 0;
    e.state.mobs = [];
    const p = e.state.player.position;
    pushMob(e.state, "zombie", true, p.x + 1, p.y, p.z, mulberry32(7));
    let attacked = false;
    for (let i = 0; i < 120; i += 1) {
      e.step(1 / 60, input({ pointerLocked: true }));
      if (e.consumeEvents().some((event) => event.type === "mobAttacked")) attacked = true;
    }
    expect(attacked).toBe(true);
  });
});
