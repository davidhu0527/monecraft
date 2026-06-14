import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { VoxelWorld } from "@/lib/world";
import { mobHalfHeight } from "@/lib/game/mobs";
import type { GameEvent, GameState, MobState } from "@/lib/game/engine/state";
import { tickMobs, type MobTickDeps } from "@/lib/game/engine/systems/mobAI";
import type { MobKind } from "@/lib/game/types";

function makeMob(kind: MobKind, x: number, y: number, z: number, attackTimer = 0): MobState {
  return {
    id: 1,
    kind,
    hostile: true,
    hp: 9,
    position: new THREE.Vector3(x, y, z),
    direction: new THREE.Vector3(0, 0, 1),
    yaw: 0,
    turnTimer: 5,
    speed: 1.08,
    moveSpeed: 1.08,
    detectRange: kind === "zombie" ? 11 : 12,
    attackDamage: 3,
    attackCooldown: 1.8,
    attackTimer,
    halfHeight: mobHalfHeight(kind),
    bobSeed: 0,
    fedTimer: 0,
    ageTimer: 0
  };
}

function makeState(mobs: MobState[]): GameState {
  return {
    world: new VoxelWorld(48, 48, 48, 1),
    mobs,
    projectiles: [],
    nextProjectileId: 1,
    daylight: 0.1, // night-ish so hostiles stay active and don't burn
    player: { position: new THREE.Vector3(24, 30, 24), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true }
  } as unknown as GameState;
}

function makeDeps() {
  const events: GameEvent[] = [];
  let damage = 0;
  const deps: MobTickDeps = {
    surfaceYAt: () => 29, // keeps mob.y ≈ player.y so the vertical gap stays small
    applyDamage: (a: number) => {
      damage += a;
    },
    removeMobAt: () => {},
    rng: () => 0.5,
    emit: (e: GameEvent) => events.push(e)
  };
  return { deps, events, getDamage: () => damage };
}

describe("ranged skeletons", () => {
  test("a skeleton with line of sight fires an arrow and re-arms its cooldown", () => {
    const skeleton = makeMob("skeleton", 24, 30, 17); // ~7 blocks away, in the standoff band
    const state = makeState([skeleton]);
    const { deps, events } = makeDeps();

    tickMobs(state, 0.05, deps);

    expect(state.projectiles).toHaveLength(1);
    expect(state.projectiles[0].fromPlayer).toBe(false);
    expect(skeleton.attackTimer).toBeCloseTo(skeleton.attackCooldown, 5);
    expect(events.some((e) => e.type === "mobAttacked" && e.kind === "skeleton")).toBe(true);
  });

  test("a skeleton kites away when the player is too close", () => {
    const skeleton = makeMob("skeleton", 24, 30, 21, 1); // 3 blocks away (< standoff min), cooldown not ready
    const state = makeState([skeleton]);
    const { deps } = makeDeps();
    const startZ = skeleton.position.z;

    tickMobs(state, 0.05, deps);

    // Player is at z=24; backing away means moving toward smaller z.
    expect(skeleton.position.z).toBeLessThan(startZ);
  });

  test("a zombie still melees and shoots nothing", () => {
    const zombie = makeMob("zombie", 24, 30, 21.5); // ~2.5 blocks, within melee reach
    const state = makeState([zombie]);
    const { deps, events, getDamage } = makeDeps();

    tickMobs(state, 0.05, deps);

    expect(state.projectiles).toHaveLength(0);
    expect(getDamage()).toBe(3); // melee damage applied
    expect(events.some((e) => e.type === "mobAttacked" && e.kind === "zombie")).toBe(true);
  });
});
