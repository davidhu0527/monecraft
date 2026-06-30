import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BlockId, VoxelWorld } from "@/lib/world";
import { TNT_FUSE_SECONDS } from "@/lib/game/config";
import { createBlockChangeTracker } from "@/lib/game/engine/blockChanges";
import { createTimers, type GameEvent, type GameState, type MobState } from "@/lib/game/engine/state";
import { explode, primeTnt, tickPrimedTnt } from "@/lib/game/engine/systems/explosion";

/** A 24³ world whose lower half is solid dirt — soft blocks the blast can clear. */
function makeWorld(): VoxelWorld {
  const world = new VoxelWorld(24, 24, 24, 1);
  for (let x = 0; x < world.sizeX; x += 1) {
    for (let z = 0; z < world.sizeZ; z += 1) {
      for (let y = 0; y < 12; y += 1) world.set(x, y, z, BlockId.Dirt);
    }
  }
  return world;
}

function makeMob(x: number, y: number, z: number, hp = 20): MobState {
  return {
    id: 1,
    kind: "zombie",
    hostile: true,
    faction: "hostile",
    targetId: null,
    retargetTimer: 0,
    hp,
    position: new THREE.Vector3(x, y, z),
    direction: new THREE.Vector3(1, 0, 0),
    yaw: 0,
    turnTimer: 0,
    speed: 1,
    moveSpeed: 1,
    detectRange: 11,
    attackDamage: 3,
    attackCooldown: 1,
    attackTimer: 0,
    halfHeight: 0.9,
    bobSeed: 0,
    fedTimer: 0,
    ageTimer: 0
  };
}

function makeState(world: VoxelWorld, mobs: MobState[] = []): GameState {
  return {
    world,
    blockChanges: createBlockChangeTracker(world),
    player: { position: new THREE.Vector3(0, 64, 0), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true },
    mobs,
    primedTnt: new Map<number, number>(),
    worldMeshDirty: false,
    timers: createTimers()
  } as unknown as GameState;
}

function deps(events: GameEvent[], damages: number[]) {
  return {
    applyDamage: (amount: number) => damages.push(amount),
    rng: () => 0.5,
    emit: (e: GameEvent) => events.push(e)
  };
}

describe("explode — block destruction", () => {
  test("clears a sphere of soft blocks and sets the remesh flag once, emitting one event", () => {
    const world = makeWorld();
    const state = makeState(world);
    const events: GameEvent[] = [];
    explode(state, 8.5, 8.5, 8.5, 3, deps(events, []));

    expect(world.get(8, 8, 8)).toBe(BlockId.Air); // center cleared
    expect(world.get(8, 10, 8)).toBe(BlockId.Air); // distance 2 — solidly inside the blast
    expect(world.get(8, 4, 8)).toBe(BlockId.Dirt); // distance 4 > power 3 — untouched
    expect(state.worldMeshDirty).toBe(true);
    expect(events.filter((e) => e.type === "explosion")).toHaveLength(1);
  });

  test("never breaks bedrock or a spawner inside the blast", () => {
    const world = makeWorld();
    world.set(8, 8, 9, BlockId.Bedrock);
    world.set(9, 8, 8, BlockId.Spawner);
    const state = makeState(world);
    explode(state, 8.5, 8.5, 8.5, 3, deps([], []));

    expect(world.get(8, 8, 9)).toBe(BlockId.Bedrock);
    expect(world.get(9, 8, 8)).toBe(BlockId.Spawner);
  });
});

describe("explode — damage falloff", () => {
  test("damages the player most at the center and less at the edge", () => {
    const near: number[] = [];
    const far: number[] = [];
    const sNear = makeState(makeWorld());
    sNear.player.position.set(8.5, 8.5, 8.5);
    explode(sNear, 8.5, 8.5, 8.5, 3, deps([], near));

    const sFar = makeState(makeWorld());
    sFar.player.position.set(8.5 + 5, 8.5, 8.5); // dist 5, within range (power*2 = 6)
    explode(sFar, 8.5, 8.5, 8.5, 3, deps([], far));

    expect(near[0]).toBeGreaterThan(far[0]);
    expect(far[0]).toBeGreaterThanOrEqual(1); // still inside the damage radius
  });

  test("leaves a player outside the damage radius unharmed and applies knockback inside it", () => {
    const damages: number[] = [];
    const state = makeState(makeWorld());
    state.player.position.set(8.5 + 7, 8.5, 8.5); // dist 7 > power*2 = 6
    explode(state, 8.5, 8.5, 8.5, 3, deps([], damages));
    expect(damages).toHaveLength(0);

    const hit = makeState(makeWorld());
    hit.player.position.set(8.5 + 2, 8.5, 8.5);
    explode(hit, 8.5, 8.5, 8.5, 3, deps([], []));
    expect(hit.player.velocity.x).toBeGreaterThan(0); // shoved away from the blast
  });

  test("damages mobs in range without removing them (caller sweeps the dead)", () => {
    const mob = makeMob(9.5, 8.5, 8.5, 20);
    const state = makeState(makeWorld(), [mob]);
    explode(state, 8.5, 8.5, 8.5, 3, deps([], []));
    expect(mob.hp).toBeLessThan(20);
    expect(state.mobs).toHaveLength(1); // explode only lowers hp; it never splices
  });
});

describe("primed TNT", () => {
  test("primeTnt lights a fuse and tickPrimedTnt detonates it when the fuse runs out", () => {
    const world = makeWorld();
    world.set(8, 12, 8, BlockId.Tnt); // a TNT block sitting on the dirt
    const state = makeState(world);
    const events: GameEvent[] = [];
    const d = deps(events, []);

    primeTnt(state, 8, 12, 8, d.emit);
    expect(state.primedTnt.size).toBe(1);
    expect(events.some((e) => e.type === "tntPrimed")).toBe(true);

    tickPrimedTnt(state, TNT_FUSE_SECONDS - 0.1, d); // not yet
    expect(state.primedTnt.size).toBe(1);
    expect(world.get(8, 12, 8)).toBe(BlockId.Tnt);

    tickPrimedTnt(state, 0.2, d); // fuse expires
    expect(world.get(8, 12, 8)).toBe(BlockId.Air);
    expect(state.primedTnt.size).toBe(0);
    expect(events.some((e) => e.type === "explosion")).toBe(true);
  });

  test("a blast chains adjacent TNT by lighting it rather than vaporizing it", () => {
    const world = makeWorld();
    world.set(10, 12, 8, BlockId.Tnt); // adjacent to the blast, within radius
    const state = makeState(world);
    explode(state, 9.5, 12.5, 8.5, 4, deps([], []));

    // The neighboring TNT survives the blast but is now primed (will blow next).
    expect(world.get(10, 12, 8)).toBe(BlockId.Tnt);
    expect(state.primedTnt.has(world.index(10, 12, 8))).toBe(true);
  });

  test("a primed TNT block that was mined away never detonates", () => {
    const world = makeWorld();
    world.set(8, 12, 8, BlockId.Tnt);
    const state = makeState(world);
    primeTnt(state, 8, 12, 8, () => {});
    world.set(8, 12, 8, BlockId.Air); // mined before the fuse ran out

    const events: GameEvent[] = [];
    tickPrimedTnt(state, TNT_FUSE_SECONDS + 1, deps(events, []));
    expect(state.primedTnt.size).toBe(0);
    expect(events.some((e) => e.type === "explosion")).toBe(false);
  });
});
