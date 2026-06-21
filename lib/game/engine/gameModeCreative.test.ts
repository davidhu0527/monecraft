import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BlockId, voxelRaycast } from "@/lib/world";
import { EYE_HEIGHT, MAX_HEARTS, MAX_OXYGEN, MINE_REACH } from "@/lib/game/config";
import { countsById } from "@/lib/game/inventory";
import { createSlot } from "@/lib/game/items";
import { GameEngine } from "@/lib/game/engine/GameEngine";
import { lookDirection } from "@/lib/game/engine/systems/playerMotion";
import { applyDamageWithArmor, applyNonLethalDamage, applyUnmitigatedDamage } from "@/lib/game/engine/systems/playerLife";
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

function calmDaytime(engine: GameEngine): void {
  engine.state.mobs = engine.state.mobs.filter((mob) => !mob.hostile);
  engine.state.dayClock = 60;
}

describe("creative invulnerability", () => {
  test("every damage path no-ops and never kills", () => {
    const e = makeEngine("creative");
    e.state.hearts = 8;
    expect(applyDamageWithArmor(e.state, 100)).toBe(false);
    expect(applyUnmitigatedDamage(e.state, 100)).toBe(false);
    expect(applyNonLethalDamage(e.state, 100, 1)).toBe(false);
    expect(e.state.hearts).toBe(8);
    expect(e.state.isDead).toBe(false);
  });

  test("hearts and oxygen are kept topped up; hunger never drains", () => {
    const e = makeEngine("creative");
    calmDaytime(e);
    e.state.hearts = 3;
    e.state.hunger = 4;
    e.state.oxygen = 1;
    // Move around for a bit — survival would drain hunger and the bars would not refill.
    for (let i = 0; i < 120; i += 1) e.step(1 / 60, input({ keys: ["KeyW"], pointerLocked: true }));
    expect(e.state.hearts).toBe(MAX_HEARTS);
    expect(e.state.hunger).toBe(4); // unchanged: no drain in creative
    expect(e.state.oxygen).toBe(MAX_OXYGEN);
  });
});

describe("flight", () => {
  test("toggleFlight only flips in a flying-capable mode", () => {
    const survival = makeEngine("survival");
    survival.dispatch({ type: "toggleFlight" });
    expect(survival.state.isFlying).toBe(false);

    const creative = makeEngine("creative");
    creative.dispatch({ type: "toggleFlight" });
    expect(creative.state.isFlying).toBe(true);
    creative.dispatch({ type: "toggleFlight" });
    expect(creative.state.isFlying).toBe(false);
  });

  test("flying replaces gravity with direct vertical control", () => {
    const e = makeEngine("creative");
    calmDaytime(e);
    e.state.isFlying = true;
    const startY = e.state.player.position.y;

    // Space ascends.
    e.step(1 / 60, input({ keys: ["Space"], pointerLocked: true }));
    expect(e.state.player.velocity.y).toBeGreaterThan(0);
    expect(e.state.player.position.y).toBeGreaterThan(startY);

    // No keys hovers — no gravity pulls the player down.
    const hoverY = e.state.player.position.y;
    e.step(1 / 60, input({ pointerLocked: true }));
    expect(e.state.player.velocity.y).toBe(0);
    expect(e.state.player.position.y).toBeCloseTo(hoverY, 5);
  });
});

// Eye-ray the engine itself uses, so tests target exactly what mining/placing hit.
function aimedHit(e: GameEngine) {
  const p = e.state.player;
  const origin = new THREE.Vector3(p.position.x, p.position.y + EYE_HEIGHT, p.position.z);
  const dir = lookDirection(p.yaw, p.pitch, new THREE.Vector3());
  return voxelRaycast(e.state.world, origin, dir, MINE_REACH);
}

describe("creative free build", () => {
  test("breaks any block instantly in one frame, with no drop or tool", () => {
    const e = makeEngine("creative");
    calmDaytime(e);
    e.state.player.velocity.set(0, 0, 0);
    e.state.player.pitch = -Math.PI / 2 + 0.01; // look straight down at the floor
    const hit = aimedHit(e);
    expect(hit).not.toBeNull();
    const { x, y, z } = hit!.hit;
    expect(e.state.world.get(x, y, z)).not.toBe(BlockId.Air);
    const before = countsById(e.state.inventory);

    // One short frame: survival could never break a block this fast (and bare
    // hands can't break stone at all) — creative breaks instantly, no tool.
    e.step(1 / 60, input({ leftMouseHeld: true, pointerLocked: true }));

    expect(e.state.world.get(x, y, z)).toBe(BlockId.Air);
    expect(countsById(e.state.inventory)).toEqual(before); // no drop collected
  });

  test("placing a block does not spend the held stack", () => {
    const e = makeEngine("creative");
    calmDaytime(e);
    const p = e.state.player;
    // Stand at the cell center so a level ray isn't aligned to a voxel boundary
    // (an exact boundary + axis-aligned look is a raycast edge case players never hit).
    p.position.x = Math.floor(p.position.x) + 0.5;
    p.position.z = Math.floor(p.position.z) + 0.5;
    const px = Math.floor(p.position.x);
    const ey = Math.floor(p.position.y + EYE_HEIGHT); // the eye's voxel row — where a level ray travels
    const pz = Math.floor(p.position.z);
    // A wall three cells ahead (+x) with a clear path; the placed cell (px+2)
    // is far enough that it can't overlap the player's body and get refused.
    e.state.blockChanges.set(px, ey, pz, BlockId.Air);
    e.state.blockChanges.set(px + 1, ey, pz, BlockId.Air);
    e.state.blockChanges.set(px + 2, ey, pz, BlockId.Air);
    e.state.blockChanges.set(px + 3, ey, pz, BlockId.Stone);
    p.yaw = -Math.PI / 2; // forward = +x
    p.pitch = 0;
    e.state.selectedSlot = 0;
    e.state.inventory[0] = createSlot("dirt", 10);

    e.dispatch({ type: "placeBlock" });

    expect(e.state.world.get(px + 2, ey, pz)).toBe(BlockId.Dirt); // placed onto the wall face
    expect(e.state.inventory[0].count).toBe(10); // stack untouched in creative
  });

  test("breaking a chest is a free, dropless break — no spill, no full-inventory refusal", () => {
    const e = makeEngine("creative");
    calmDaytime(e);
    e.state.player.velocity.set(0, 0, 0);
    e.state.player.pitch = -Math.PI / 2 + 0.01; // look straight down
    const hit = aimedHit(e);
    expect(hit).not.toBeNull();
    const { x, y, z } = hit!.hit;
    const idx = e.state.world.index(x, y, z);
    // Make the targeted floor block a chest holding loot.
    e.state.blockChanges.set(x, y, z, BlockId.Chest);
    e.state.containers.set(idx, [createSlot("diamond_ore", 5)]);
    const before = countsById(e.state.inventory);

    e.step(1 / 60, input({ leftMouseHeld: true, pointerLocked: true }));

    expect(e.state.world.get(x, y, z)).toBe(BlockId.Air); // broken instantly
    expect(e.state.containers.has(idx)).toBe(false); // contents vanished, not spilled into the inventory
    expect(countsById(e.state.inventory)).toEqual(before); // nothing added
  });
});

describe("creative palette give", () => {
  test("creativeGiveItem inserts a stack in creative and no-ops elsewhere", () => {
    const creative = makeEngine("creative");
    creative.dispatch({ type: "creativeGiveItem", itemId: "diamond_ore" });
    expect(countsById(creative.state.inventory).get("diamond_ore") ?? 0).toBeGreaterThan(0);

    const survival = makeEngine("survival");
    survival.dispatch({ type: "creativeGiveItem", itemId: "diamond_ore" });
    expect(countsById(survival.state.inventory).get("diamond_ore") ?? 0).toBe(0);
  });

  test("creativeGiveItem ignores an unknown item id", () => {
    const e = makeEngine("creative");
    const before = countsById(e.state.inventory);
    e.dispatch({ type: "creativeGiveItem", itemId: "not_a_real_item" });
    expect(countsById(e.state.inventory)).toEqual(before);
  });
});
