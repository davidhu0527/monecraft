import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { spawnArrow } from "@/lib/game/engine/projectiles";
import type { GameState } from "@/lib/game/engine/state";

function makeState(): GameState {
  return { projectiles: [], nextProjectileId: 1 } as unknown as GameState;
}

describe("spawnArrow", () => {
  test("sets velocity = dir*speed, assigns sequential ids, and pushes the arrow", () => {
    const state = makeState();
    const a = spawnArrow(state, 0, 10, 0, new THREE.Vector3(0, 0, -1), { speed: 30, damage: 9, knockback: 0.5, fromPlayer: true, ttl: 4 });
    expect(a.id).toBe(1);
    expect(a.velocity.z).toBeCloseTo(-30, 5);
    expect(a.damage).toBe(9);
    expect(a.fromPlayer).toBe(true);
    expect(state.projectiles).toHaveLength(1);

    const b = spawnArrow(state, 0, 10, 0, new THREE.Vector3(1, 0, 0), { speed: 20, damage: 4, knockback: 0.2, fromPlayer: false, ttl: 3 });
    expect(b.id).toBe(2);
    expect(b.velocity.x).toBeCloseTo(20, 5);
    expect(b.fromPlayer).toBe(false);
    expect(state.nextProjectileId).toBe(3);
    expect(state.projectiles).toHaveLength(2);
  });

  test("normalizes the direction before applying speed", () => {
    const state = makeState();
    const a = spawnArrow(state, 0, 0, 0, new THREE.Vector3(0, 0, -5), { speed: 10, damage: 1, knockback: 0, fromPlayer: true, ttl: 1 });
    expect(a.velocity.length()).toBeCloseTo(10, 5);
  });

  test("spawns the arrow ahead of the muzzle so the firer never self-hits", () => {
    const state = makeState();
    const a = spawnArrow(state, 0, 10, 0, new THREE.Vector3(0, 0, -1), { speed: 10, damage: 1, knockback: 0, fromPlayer: true, ttl: 1 });
    expect(a.position.z).toBeLessThan(0); // pushed forward along -z
  });
});
