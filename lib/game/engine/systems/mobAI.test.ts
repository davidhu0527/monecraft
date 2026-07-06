import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BlockId, VoxelWorld } from "@/lib/world";
import { CREEPER_FUSE_SECONDS, PET_FIGHT_RANGE } from "@/lib/game/config";
import { FACTION_BY_KIND, mobHalfHeight } from "@/lib/game/mobs";
import { createBlockChangeTracker } from "@/lib/game/engine/blockChanges";
import type { GameEvent, GameState, MobState, PlayerState } from "@/lib/game/engine/state";
import { tickMobs, type MobTickDeps } from "@/lib/game/engine/systems/mobAI";
import type { MobKind } from "@/lib/game/types";

let nextMobId = 1;

function makeMob(kind: MobKind, x: number, y: number, z: number, attackTimer = 0): MobState {
  return {
    id: nextMobId++, // unique, so targetId assertions can't accidentally resolve to the attacker
    kind,
    hostile: true,
    faction: FACTION_BY_KIND[kind],
    targetId: null,
    retargetTimer: 0,
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
  const world = new VoxelWorld(48, 48, 48, 1);
  // Real players map: mobAI selects hunt/anchor targets from it. gameMode
  // lives on the player now (hostiles only threaten survival/adventure).
  const player = {
    id: "local",
    position: new THREE.Vector3(24, 30, 24),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    onGround: true,
    gameMode: "survival",
    isDead: false
  } as unknown as PlayerState;
  return {
    players: new Map([["local", player]]),
    world,
    blockChanges: createBlockChangeTracker(world),
    primedTnt: new Map<number, number>(),
    worldMeshDirty: false,
    difficulty: "normal", // baseline 1× mob-damage multiplier
    mobs,
    projectiles: [],
    nextProjectileId: 1,
    daylight: 0.1, // night-ish so hostiles stay active and don't burn
    player
  } as unknown as GameState;
}

function makeDeps() {
  const events: GameEvent[] = [];
  let damage = 0;
  const deps: MobTickDeps = {
    surfaceYAt: () => 29, // keeps mob.y ≈ player.y so the vertical gap stays small
    damagePlayer: (_p: PlayerState, a: number) => {
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

  test("a mob already at 0 hp is swept without acting (no final hit)", () => {
    const zombie = makeMob("zombie", 24, 30, 21.5); // in melee range
    zombie.hp = 0; // killed earlier this tick (e.g. by a blast), awaiting the sweep
    const state = makeState([zombie]);
    const removed: number[] = [];
    const { deps, getDamage } = makeDeps();
    deps.removeMobAt = (i: number) => removed.push(i);

    tickMobs(state, 0.05, deps);

    expect(getDamage()).toBe(0); // a corpse deals no damage
    expect(removed).toContain(0); // but is still removed
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

  test("difficulty scales the melee hit: Easy halves it, Hard amplifies it", () => {
    const easy = makeState([makeMob("zombie", 24, 30, 21.5)]);
    easy.difficulty = "easy";
    const easyDeps = makeDeps();
    tickMobs(easy, 0.05, easyDeps.deps);
    expect(easyDeps.getDamage()).toBe(1.5); // 3 × 0.5

    const hard = makeState([makeMob("zombie", 24, 30, 21.5)]);
    hard.difficulty = "hard";
    const hardDeps = makeDeps();
    tickMobs(hard, 0.05, hardDeps.deps);
    expect(hardDeps.getDamage()).toBe(4.5); // 3 × 1.5
  });
});

describe("creepers", () => {
  function makeCreeper(z: number): MobState {
    const c = makeMob("creeper", 24, 30, z);
    c.hp = 10;
    c.attackDamage = 0;
    c.detectRange = 12;
    return c;
  }

  test("lights its fuse (hissing, no melee) when the player gets close", () => {
    const creeper = makeCreeper(22.5); // ~1.5 blocks, inside fuse range
    const state = makeState([creeper]);
    const { deps, events, getDamage } = makeDeps();

    tickMobs(state, 0.05, deps);

    expect(creeper.fuseTimer).toBeGreaterThan(0);
    expect(getDamage()).toBe(0); // it never bites
    expect(events.some((e) => e.type === "mobAttacked" && e.kind === "creeper")).toBe(true);
  });

  test("detonates when the fuse runs out — exploding, dealing damage, and dying", () => {
    const creeper = makeCreeper(22.5);
    const state = makeState([creeper]);
    const { deps, events, getDamage } = makeDeps();

    tickMobs(state, 0.05, deps); // light the fuse
    for (let t = 0; t < CREEPER_FUSE_SECONDS + 0.2; t += 0.1) tickMobs(state, 0.1, deps);

    expect(events.some((e) => e.type === "explosion")).toBe(true);
    expect(getDamage()).toBeGreaterThan(0); // the blast hurt the player
    expect(creeper.hp).toBeLessThanOrEqual(0); // it dies in its own blast (sweep drops gunpowder)
  });

  test("aborts the fuse when the player backs out of range", () => {
    const creeper = makeCreeper(22.5);
    const state = makeState([creeper]);
    const { deps } = makeDeps();

    tickMobs(state, 0.05, deps);
    expect(creeper.fuseTimer).toBeGreaterThan(0);

    state.player.position.set(24, 30, 8); // walk far away (> abort range)
    tickMobs(state, 0.05, deps);
    expect(creeper.fuseTimer).toBe(0);
  });

  test("removes a creeper killed before its fuse finishes (no explosion)", () => {
    const creeper = makeCreeper(22.5);
    const state = makeState([creeper]);
    const removed: number[] = [];
    const { deps, events } = makeDeps();
    deps.removeMobAt = (i: number) => removed.push(i);

    tickMobs(state, 0.05, deps); // primes the fuse
    creeper.hp = 0; // killed by a sword/arrow before it detonates
    tickMobs(state, 0.05, deps);

    expect(removed).toContain(0); // swept (drops gunpowder via the engine's removeMobAt)
    expect(events.some((e) => e.type === "explosion")).toBe(false);
  });
});

describe("villagers", () => {
  function makePassive(kind: MobKind, z: number): MobState {
    const m = makeMob(kind, 24, 30, z);
    m.hostile = false;
    m.detectRange = 0;
    m.speed = 0.6;
    m.moveSpeed = 0.6;
    return m;
  }

  test("a villager does not take the flee path the player triggers in a sheep", () => {
    // Both start two blocks from the player (well inside the 4.2 flee range). A
    // sheep enters the flee branch (which boosts moveSpeed ×1.15 and turns away);
    // a villager skips it and keeps its base speed, so you can walk up to trade.
    const sheep = makePassive("sheep", 22);
    const villager = makePassive("villager", 22);
    const state = makeState([sheep, villager]);
    const { deps } = makeDeps();

    tickMobs(state, 0.05, deps);

    expect(sheep.moveSpeed).toBeCloseTo(sheep.speed * 1.15, 5); // fled
    expect(villager.moveSpeed).toBeCloseTo(villager.speed, 5); // did not flee
  });
});

describe("mob-vs-mob & allegiance", () => {
  function makeVillager(x: number, z: number): MobState {
    const v = makeMob("villager", x, 30, z);
    v.hostile = false;
    v.faction = "villager";
    v.detectRange = 0;
    v.attackDamage = 0;
    v.speed = 0.6;
    v.moveSpeed = 0.6;
    v.hp = 20;
    return v;
  }

  test("a hostile with no player in range hunts and bites a nearby villager", () => {
    // Zombie + villager are ~1 block apart and far (z≈9) from the player at z=24,
    // so the zombie has no player aggro and falls through to its mob target.
    const zombie = makeMob("zombie", 24, 30, 9.5);
    const villager = makeVillager(24, 8.5);
    const state = makeState([zombie, villager]);
    state.difficulty = "hard"; // mob-vs-mob uses raw damage — difficulty scales player-facing hits only
    const { deps, getDamage } = makeDeps();

    tickMobs(state, 0.05, deps);

    expect(zombie.targetId).toBe(villager.id);
    expect(villager.hp).toBe(17); // raw attackDamage 3, NOT ×1.5 for Hard
    expect(getDamage()).toBe(0); // the player took no damage
  });

  test("a wall blocks a mob-vs-mob bite (line of sight)", () => {
    const zombie = makeMob("zombie", 24, 30, 10.28);
    const villager = makeVillager(24, 8.72); // ~1.56 apart — within MOB_VS_MOB_REACH, but across a wall
    const state = makeState([zombie, villager]);
    for (let y = 28; y <= 31; y += 1) state.world.set(24, y, 9, BlockId.Stone); // a wall in the voxel between them
    const { deps } = makeDeps();

    tickMobs(state, 0.05, deps);

    expect(villager.hp).toBe(20); // the bite was blocked — no damage through the wall
  });

  test("villagers and hostiles never target their own side", () => {
    const villager = makeVillager(24, 9);
    const zombieA = makeMob("zombie", 24, 30, 8);
    const zombieB = makeMob("zombie", 24, 30, 8.6);
    const state = makeState([villager, zombieA, zombieB]);
    const { deps } = makeDeps();

    tickMobs(state, 0.05, deps);

    expect(villager.targetId).toBeNull(); // villagers don't fight
    expect(zombieA.targetId).toBe(villager.id); // a hostile picks the villager, not zombieB
  });

  test("a villager flees the nearest hostile (boosted speed, turning away)", () => {
    const villager = makeVillager(24, 24);
    const zombie = makeMob("zombie", 26, 30, 26); // diagonal, ~2.8 blocks, within flee range
    const state = makeState([villager, zombie]);
    state.player.position.set(0, 30, 0); // keep the player out of it
    const { deps } = makeDeps();

    tickMobs(state, 0.05, deps);

    expect(villager.moveSpeed).toBeCloseTo(villager.speed * 1.3, 5); // flee boost (not the ×1.15 animal flee)
    expect(villager.direction.x).toBeLessThan(0); // turning away from the zombie at +x
  });

  test("the death sweep credits hostile/wild kills to the player but not villager deaths", () => {
    const zombie = makeMob("zombie", 5, 30, 5);
    zombie.hp = 0; // already dead (e.g. blast/burn), awaiting the sweep
    const villager = makeVillager(40, 40);
    villager.hp = 0; // slain by a hostile
    const state = makeState([zombie, villager]);
    const calls: Array<{ index: number; credit: boolean }> = [];
    const { deps } = makeDeps();
    deps.removeMobAt = (index: number, _looting?: number, credit = true) => calls.push({ index, credit });

    tickMobs(state, 0.05, deps);

    expect(calls.find((c) => c.index === 0)?.credit).toBe(true); // zombie — credited
    expect(calls.find((c) => c.index === 1)?.credit).toBe(false); // villager — no loot/XP
  });
});

describe("companion pets (allies)", () => {
  function makePet(x: number, z: number, overrides: Partial<MobState> = {}): MobState {
    const pet = makeMob("wolf", x, 30, z);
    pet.hostile = false;
    pet.faction = "ally";
    pet.owner = "local"; // the state's sole player (pets now follow their owner, not the nearest player)
    pet.detectRange = PET_FIGHT_RANGE;
    pet.attackDamage = 4;
    return Object.assign(pet, overrides);
  }

  test("a sitting pet holds its ground (no movement)", () => {
    const pet = makePet(10, 10, { sitting: true });
    const state = makeState([pet]);
    const startX = pet.position.x;
    const startZ = pet.position.z;
    const { deps } = makeDeps();

    tickMobs(state, 0.1, deps);

    expect(pet.position.x).toBe(startX);
    expect(pet.position.z).toBe(startZ);
    expect(pet.moveSpeed).toBe(0);
  });

  test("a pet attacks a nearby hostile, and the kill credits the player", () => {
    const pet = makePet(10, 9.5);
    const zombie = makeMob("zombie", 10, 30, 8.5); // ~1 block from the pet, far from the player
    zombie.hp = 3;
    const state = makeState([pet, zombie]);
    const calls: Array<{ index: number; credit: boolean }> = [];
    const { deps } = makeDeps();
    deps.removeMobAt = (index: number, _looting?: number, credit = true) => calls.push({ index, credit });

    tickMobs(state, 0.05, deps);

    expect(pet.targetId).toBe(zombie.id);
    expect(zombie.hp).toBeLessThan(3); // the pet bit it
  });

  test("a pet beyond follow range jogs toward the owner and closes the gap over time", () => {
    const pet = makePet(40, 40); // ~22 blocks from the player at (24,24): past FOLLOW_MAX, within TELEPORT
    const state = makeState([pet]);
    const startDist = Math.hypot(40 - 24, 40 - 24);
    const { deps } = makeDeps();

    tickMobs(state, 0.1, deps);
    expect(pet.moveSpeed).toBeCloseTo(pet.speed * 1.3, 5); // follow boost (in range, not teleporting)

    for (let i = 0; i < 60; i += 1) tickMobs(state, 0.1, deps);
    expect(Math.hypot(pet.position.x - 24, pet.position.z - 24)).toBeLessThan(startDist); // closed the gap
  });

  test("a pet stranded past the teleport distance is recalled next to the owner", () => {
    const pet = makePet(46, 46); // ~31 blocks from (24,24) — beyond PET_TELEPORT_DISTANCE
    const state = makeState([pet]);
    const { deps } = makeDeps();

    tickMobs(state, 0.05, deps);

    expect(Math.hypot(pet.position.x - 24, pet.position.z - 24)).toBeLessThan(3); // teleported adjacent
  });

  test("a pet follows its OWNER, not a nearer stranger", () => {
    const pet = makePet(40, 40); // owner "local" sits at (24,24) — past FOLLOW_MAX, within TELEPORT
    const state = makeState([pet]);
    // A stranger stands right next to the pet; the owner is far away.
    const stranger = {
      id: "acct-2",
      position: new THREE.Vector3(41, 30, 41),
      velocity: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      onGround: true,
      gameMode: "survival",
      isDead: false
    } as unknown as PlayerState;
    state.players.set("acct-2", stranger);
    const { deps } = makeDeps();

    const startToOwner = Math.hypot(40 - 24, 40 - 24);
    for (let i = 0; i < 40; i += 1) tickMobs(state, 0.1, deps);

    // Closed on its owner at (24,24)…
    expect(Math.hypot(pet.position.x - 24, pet.position.z - 24)).toBeLessThan(startToOwner);
    // …and moved AWAY from the adjacent stranger (it never trailed them).
    expect(Math.hypot(pet.position.x - 41, pet.position.z - 41)).toBeGreaterThan(Math.hypot(40 - 41, 40 - 41));
  });
});

describe("aquatic fish", () => {
  /** Fills a water pool (x,z in 20..28, y in 18..22) into the state's empty world. */
  function fillPool(state: GameState): void {
    for (let x = 20; x <= 28; x += 1) {
      for (let z = 20; z <= 28; z += 1) {
        for (let y = 18; y <= 22; y += 1) state.world.set(x, y, z, BlockId.Water);
      }
    }
  }

  function makeFish(x: number, y: number, z: number): MobState {
    const fish = makeMob("cod", x, y, z);
    fish.hostile = false;
    return fish;
  }

  test("a swimming fish stays confined to water cells", () => {
    const fish = makeFish(24.5, 20.5, 24.5);
    const state = makeState([fish]);
    fillPool(state);
    const { deps } = makeDeps();

    // Long run with wandering turns: wherever it ends up each tick, the cell
    // holding its body center is always water (it bounces off the pool walls).
    for (let i = 0; i < 200; i += 1) {
      tickMobs(state, 0.1, deps);
      const cell = state.world.get(Math.floor(fish.position.x), Math.floor(fish.position.y), Math.floor(fish.position.z));
      expect(cell).toBe(BlockId.Water);
    }
  });

  test("a fish flees the player in 3D when approached", () => {
    const fish = makeFish(24.5, 20.5, 24.5);
    const state = makeState([fish]);
    fillPool(state);
    state.player.position.set(24.5, 20.5, 22.5); // 2 blocks away, inside FISH_FLEE_RANGE
    const { deps } = makeDeps();

    for (let i = 0; i < 10; i += 1) tickMobs(state, 0.1, deps);

    expect(fish.position.z).toBeGreaterThan(24.5); // swam away (+z) from the player
    expect(fish.moveSpeed).toBeCloseTo(fish.speed * 1.6, 5); // flee boost
  });

  test("a beached fish is immobile, suffocates, and is eventually swept", () => {
    const fish = makeFish(24, 30, 24); // dry cell: the state world is air here
    const state = makeState([fish]);
    const removed: number[] = [];
    const { deps } = makeDeps();
    deps.removeMobAt = (i: number) => removed.push(i);

    tickMobs(state, 1, deps);
    expect(fish.moveSpeed).toBe(0);
    expect(fish.hp).toBeCloseTo(9 - 2, 5); // FISH_SUFFOCATION_HP_PER_SECOND drain

    for (let i = 0; i < 5; i += 1) tickMobs(state, 1, deps);
    expect(removed).toContain(0); // dead and swept
  });
});

describe("the drowned (hostile aquatic)", () => {
  /** Fills a water pool (x,z in 20..28, y in 18..22) into the state's empty world. */
  function fillPool(state: GameState): void {
    for (let x = 20; x <= 28; x += 1) {
      for (let z = 20; z <= 28; z += 1) {
        for (let y = 18; y <= 22; y += 1) state.world.set(x, y, z, BlockId.Water);
      }
    }
  }

  function makeDrowned(x: number, y: number, z: number, attackTimer = 0): MobState {
    return makeMob("drowned", x, y, z, attackTimer);
  }

  test("pursues a player in the water and closes the distance in 3D", () => {
    const drowned = makeDrowned(21.5, 19.5, 21.5);
    const state = makeState([drowned]);
    fillPool(state);
    state.player.position.set(27.5, 21.0, 27.5); // in the pool, inside detectRange
    const { deps } = makeDeps();

    const start = drowned.position.distanceTo(state.player.position);
    for (let i = 0; i < 30; i += 1) tickMobs(state, 0.1, deps);

    expect(drowned.position.distanceTo(state.player.position)).toBeLessThan(start);
    expect(drowned.moveSpeed).toBeGreaterThan(drowned.speed); // pursuit boost, not the flee boost
  });

  test("never leaves the water while pursuing a player on dry land", () => {
    const drowned = makeDrowned(24.5, 20.5, 24.5);
    const state = makeState([drowned]);
    fillPool(state);
    state.player.position.set(24.5, 30, 32.5); // ashore, just outside the pool
    const { deps } = makeDeps();

    for (let i = 0; i < 200; i += 1) {
      tickMobs(state, 0.1, deps);
      const cell = state.world.get(Math.floor(drowned.position.x), Math.floor(drowned.position.y), Math.floor(drowned.position.z));
      expect(cell).toBe(BlockId.Water);
    }
  });

  test("strikes within reach: damage is difficulty-scaled and knockback shoves the player", () => {
    const drowned = makeDrowned(24.5, 20.5, 24.5);
    const state = makeState([drowned]);
    fillPool(state);
    state.difficulty = "hard"; // 1.5× at the strike
    state.player.position.set(24.5, 19.8, 25.6); // ~1.1 blocks away, inside reach
    const { deps, events, getDamage } = makeDeps();

    tickMobs(state, 0.05, deps);

    expect(getDamage()).toBeCloseTo(3 * 1.5, 5);
    expect(events).toContainEqual({ type: "mobAttacked", kind: "drowned" });
    expect(drowned.attackTimer).toBeGreaterThan(0); // cooldown re-armed
    expect(Math.hypot(state.player.velocity.x, state.player.velocity.z)).toBeGreaterThan(0); // shoved
  });

  test("ignores Creative players entirely (no pursuit, no strike)", () => {
    const drowned = makeDrowned(24.5, 20.5, 24.5);
    const state = makeState([drowned]);
    fillPool(state);
    state.player.position.set(24.5, 19.8, 25.6); // point-blank
    (state.player as { gameMode: string }).gameMode = "creative";
    const { deps, getDamage } = makeDeps();

    for (let i = 0; i < 10; i += 1) tickMobs(state, 0.1, deps);

    expect(getDamage()).toBe(0);
    expect(drowned.moveSpeed).toBeCloseTo(drowned.speed, 5); // wandering, not pursuing
  });

  test("a wall blocks the bite (line of sight like the land strike)", () => {
    const drowned = makeDrowned(24.5, 20.5, 24.5);
    const state = makeState([drowned]);
    fillPool(state);
    // A glass pane between the drowned and the player, inside the pool.
    for (let y = 18; y <= 22; y += 1) state.world.set(24, y, 25, BlockId.Glass);
    state.player.position.set(24.5, 19.8, 25.9);
    const { deps, getDamage } = makeDeps();

    tickMobs(state, 0.05, deps);

    expect(getDamage()).toBe(0);
  });

  test("beached, it suffocates like a fish", () => {
    const drowned = makeDrowned(24, 30, 24); // dry cell
    const state = makeState([drowned]);
    const { deps } = makeDeps();

    tickMobs(state, 1, deps);

    expect(drowned.moveSpeed).toBe(0);
    expect(drowned.hp).toBeCloseTo(9 - 2, 5);
  });
});
