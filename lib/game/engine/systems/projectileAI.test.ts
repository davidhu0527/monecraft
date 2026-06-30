import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BlockId, VoxelWorld } from "@/lib/world";
import { spawnArrow } from "@/lib/game/engine/projectiles";
import { tickProjectiles } from "@/lib/game/engine/systems/projectileAI";
import type { GameEvent, GameState, MobState } from "@/lib/game/engine/state";

function makeMob(id: number, x: number, y: number, z: number, hp = 10, halfHeight = 0.5): MobState {
  return {
    id,
    kind: "zombie",
    hostile: true,
    faction: "hostile",
    targetId: null,
    retargetTimer: 0,
    hp,
    position: new THREE.Vector3(x, y, z),
    direction: new THREE.Vector3(0, 0, 1),
    yaw: 0,
    turnTimer: 0,
    speed: 1,
    moveSpeed: 1,
    detectRange: 11,
    attackDamage: 3,
    attackCooldown: 1,
    attackTimer: 0,
    halfHeight,
    bobSeed: 0,
    fedTimer: 0,
    ageTimer: 0
  };
}

function makeState(world: VoxelWorld, mobs: MobState[] = []): GameState {
  return {
    world,
    mobs,
    projectiles: [],
    nextProjectileId: 1,
    player: { position: new THREE.Vector3(16, 14, 16), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true }
  } as unknown as GameState;
}

function makeDeps() {
  const events: GameEvent[] = [];
  const removed: number[] = [];
  let damage = 0;
  const deps = {
    applyDamage: (a: number) => {
      damage += a;
    },
    removeMobAt: (i: number) => {
      removed.push(i);
    },
    emit: (e: GameEvent) => {
      events.push(e);
    }
  };
  return { deps, events, removed, getDamage: () => damage };
}

function tickUntilGone(state: GameState, deps: ReturnType<typeof makeDeps>["deps"], max = 400): number {
  let n = 0;
  while (state.projectiles.length > 0 && n < max) {
    tickProjectiles(state, 0.05, deps);
    n += 1;
  }
  return n;
}

describe("tickProjectiles", () => {
  test("arrows arc downward under gravity and despawn at ttl", () => {
    const world = new VoxelWorld(32, 32, 32, 1);
    const state = makeState(world);
    const { deps } = makeDeps();
    const arrow = spawnArrow(state, 16, 20, 16, new THREE.Vector3(0, 0, -1), { speed: 20, damage: 5, knockback: 0.3, fromPlayer: true, ttl: 0.2 });

    tickProjectiles(state, 0.05, deps);
    tickProjectiles(state, 0.05, deps);
    expect(arrow.position.z).toBeLessThan(16); // travelled along -z
    expect(arrow.velocity.y).toBeLessThan(0); // gravity pulled it down
    expect(arrow.position.y).toBeLessThan(20);

    tickProjectiles(state, 0.05, deps);
    tickProjectiles(state, 0.05, deps);
    tickProjectiles(state, 0.05, deps);
    expect(state.projectiles).toHaveLength(0); // ttl elapsed
  });

  test("an arrow sticks/despawns when it hits a wall", () => {
    const world = new VoxelWorld(32, 32, 32, 1);
    for (let y = 14; y <= 18; y += 1) for (let x = 14; x <= 18; x += 1) world.set(x, y, 10, BlockId.Stone);
    const state = makeState(world);
    const { deps, events } = makeDeps();
    spawnArrow(state, 16, 16, 16, new THREE.Vector3(0, 0, -1), { speed: 34, damage: 5, knockback: 0.3, fromPlayer: true, ttl: 4 });

    tickUntilGone(state, deps);
    expect(state.projectiles).toHaveLength(0);
    const blockHit = events.find((e) => e.type === "arrowHit" && e.target === "block");
    expect(blockHit).toBeDefined();
    if (blockHit && blockHit.type === "arrowHit") expect(blockHit.z).toBeLessThanOrEqual(11);
  });

  test("a very fast arrow still registers a 1-block-thick wall (no tunnelling)", () => {
    const world = new VoxelWorld(32, 32, 32, 1);
    world.set(12, 12, 10, BlockId.Stone); // single solid cell
    const state = makeState(world);
    const { deps, events } = makeDeps();
    // 400 m/s × 0.05 s = 20 blocks/step — would skip the wall without the swept DDA.
    // x/y at .3 keep the ray off the integer cell boundaries (avoids a DDA tie-break).
    spawnArrow(state, 12.3, 12.3, 12, new THREE.Vector3(0, 0, -1), { speed: 400, damage: 5, knockback: 0, fromPlayer: true, ttl: 4 });

    tickProjectiles(state, 0.05, deps);
    expect(state.projectiles).toHaveLength(0);
    expect(events.some((e) => e.type === "arrowHit" && e.target === "block")).toBe(true);
  });

  test("a player arrow damages and knocks back a mob, killing it when lethal", () => {
    const world = new VoxelWorld(32, 32, 32, 1);
    const mob = makeMob(1, 16, 16, 12, 10);
    const state = makeState(world, [mob]);
    const { deps, events, removed } = makeDeps();
    spawnArrow(state, 16, 16, 16, new THREE.Vector3(0, 0, -1), { speed: 34, damage: 9, knockback: 0.75, fromPlayer: true, ttl: 4 });

    tickUntilGone(state, deps);
    expect(mob.hp).toBe(1);
    expect(mob.position.z).toBeLessThan(12); // knocked along the arrow's -z travel
    expect(events.some((e) => e.type === "mobHit")).toBe(true);
    expect(events.some((e) => e.type === "arrowHit" && e.target === "mob")).toBe(true);
    expect(removed).toHaveLength(0);

    // A lethal shot triggers removeMobAt.
    const lethalMob = makeMob(2, 16, 16, 12, 5);
    const lethalState = makeState(world, [lethalMob]);
    const lethalDeps = makeDeps();
    spawnArrow(lethalState, 16, 16, 16, new THREE.Vector3(0, 0, -1), { speed: 34, damage: 9, knockback: 0.75, fromPlayer: true, ttl: 4 });
    tickUntilGone(lethalState, lethalDeps.deps);
    expect(lethalDeps.removed).toEqual([0]);
  });

  test("the fromPlayer filter routes hits: player arrows ignore the player, mob arrows ignore mobs", () => {
    // Mob arrow toward the player: damages the player, ignores other mobs.
    const world = new VoxelWorld(32, 32, 32, 1);
    const bystander = makeMob(1, 16, 14, 18, 10);
    const state = makeState(world, [bystander]);
    const { deps, getDamage } = makeDeps();
    spawnArrow(state, 16, 14.9, 20, new THREE.Vector3(0, 0, -1), { speed: 34, damage: 6, knockback: 0.4, fromPlayer: false, ttl: 4 });
    tickUntilGone(state, deps);
    expect(getDamage()).toBe(6); // player was hit
    expect(bystander.hp).toBe(10); // the bystander mob was not

    // Player arrow passing through the player position: never damages the player.
    const playerArrowState = makeState(world);
    const playerArrowDeps = makeDeps();
    spawnArrow(playerArrowState, 16, 14.9, 20, new THREE.Vector3(0, 0, -1), { speed: 34, damage: 6, knockback: 0.4, fromPlayer: true, ttl: 0.4 });
    tickUntilGone(playerArrowState, playerArrowDeps.deps);
    expect(playerArrowDeps.getDamage()).toBe(0);
  });

  test("a mob arrow pushes the player's velocity along its flight", () => {
    const world = new VoxelWorld(32, 32, 32, 1);
    const state = makeState(world);
    const { deps } = makeDeps();
    spawnArrow(state, 16, 14.9, 20, new THREE.Vector3(0, 0, -1), { speed: 34, damage: 6, knockback: 0.5, fromPlayer: false, ttl: 4 });
    tickUntilGone(state, deps);
    expect(state.player.velocity.z).toBeLessThan(0); // pushed along -z
  });
});
