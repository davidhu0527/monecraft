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

describe("spectator", () => {
  test("boots flying and phases straight through solid terrain", () => {
    const e = makeEngine("spectator");
    expect(e.state.isFlying).toBe(true);
    const p = e.state.player;
    p.position.set(8.5, 50, 36.5);
    p.velocity.set(0, 0, 0);
    // A thick stone wall at x=10 spanning the player's body rows.
    for (let dy = -1; dy <= 2; dy += 1) for (let dz = -1; dz <= 1; dz += 1) e.state.blockChanges.set(10, 50 + dy, 36 + dz, BlockId.Stone);
    p.yaw = -Math.PI / 2; // forward = +x, straight at the wall

    for (let i = 0; i < 50; i += 1) e.step(1 / 60, input({ keys: ["KeyW"], pointerLocked: true }));

    expect(p.position.x).toBeGreaterThan(10); // walked clean through the wall
    expect(p.position.y).toBeCloseTo(50, 0); // no gravity — held altitude
  });

  test("is invulnerable", () => {
    const e = makeEngine("spectator");
    e.state.hearts = 6;
    expect(applyDamageWithArmor(e.state, 100)).toBe(false);
    expect(e.state.hearts).toBe(6);
  });

  test("can't open the inventory or break blocks", () => {
    const e = makeEngine("spectator");
    e.dispatch({ type: "toggleInventory" });
    expect(e.state.inventoryOpen).toBe(false);

    const p = e.state.player;
    p.velocity.set(0, 0, 0);
    p.pitch = -Math.PI / 2 + 0.01; // look down at the floor
    const origin = new THREE.Vector3(p.position.x, p.position.y + EYE_HEIGHT, p.position.z);
    const dir = lookDirection(p.yaw, p.pitch, new THREE.Vector3());
    const hit = voxelRaycast(e.state.world, origin, dir, MINE_REACH);
    expect(hit).not.toBeNull();
    const { x, y, z } = hit!.hit;
    for (let i = 0; i < 30; i += 1) e.step(1 / 60, input({ leftMouseHeld: true, pointerLocked: true }));
    expect(e.state.world.get(x, y, z)).not.toBe(BlockId.Air); // never mined
  });

  test("inventory commands (swap) are no-ops", () => {
    const e = makeEngine("spectator");
    e.state.inventory[0] = createSlot("dirt", 5);
    e.state.inventory[1] = createSlot("stone", 3);
    e.dispatch({ type: "swapSlots", from: 0, to: 1 });
    expect(e.state.inventory[0].id).toBe("dirt"); // untouched — Spectator has no inventory
    expect(e.state.inventory[1].id).toBe("stone");
  });

  test("a saved spectator buried in terrain loads where it was (no auto-unstuck)", () => {
    const e = makeEngine("spectator");
    const p = e.state.player.position;
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    const pz = Math.floor(p.z);
    for (let dx = -1; dx <= 1; dx += 1)
      for (let dy = 0; dy <= 2; dy += 1) for (let dz = -1; dz <= 1; dz += 1) e.state.blockChanges.set(px + dx, py + dy, pz + dz, BlockId.Stone);
    const before = { x: p.x, y: p.y, z: p.z };

    const restored = new GameEngine({ save: e.serialize(), rng: mulberry32(1), worldSize: { x: 64, y: 150, z: 64 } });

    expect(restored.state.player.position.x).toBeCloseTo(before.x, 5);
    expect(restored.state.player.position.y).toBeCloseTo(before.y, 5);
    expect(restored.state.player.position.z).toBeCloseTo(before.z, 5);
  });
});

// Adjacent hostile + frames; returns whether it ever lands an attack.
function hostileAttacks(mode: GameMode): boolean {
  const e = makeEngine(mode);
  e.state.dayClock = 0; // low daylight, no daytime burn
  e.state.mobs = [];
  const p = e.state.player.position;
  pushMob(e.state, "zombie", true, p.x + 1, p.y, p.z, mulberry32(7));
  let attacked = false;
  for (let i = 0; i < 120; i += 1) {
    e.step(1 / 60, input({ pointerLocked: true }));
    if (e.consumeEvents().some((event) => event.type === "mobAttacked")) attacked = true;
  }
  return attacked;
}

describe("mobs and game mode", () => {
  test("hostiles attack in survival but completely ignore a spectator", () => {
    expect(hostileAttacks("survival")).toBe(true);
    expect(hostileAttacks("spectator")).toBe(false);
  });
});
