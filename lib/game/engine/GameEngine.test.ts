import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BlockId, collidesAt } from "@/lib/world";
import {
  DAY_CYCLE_SECONDS,
  EYE_HEIGHT,
  MAX_HUNGER,
  MAX_HEARTS,
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT,
  REGEN_MIN_HUNGER,
  SPRINT_BLOCKS_PER_HUNGER,
  SPRINT_MIN_HUNGER,
  WATER_DAMAGE_DELAY_SECONDS,
  WATER_DAMAGE_HP
} from "@/lib/game/config";
import { BOSS_HP, CHEST_SLOTS } from "@/lib/game/config";
import { countsById } from "@/lib/game/inventory";
import { createEmptySlot, createSlot } from "@/lib/game/items";
import { CONTAINER_SLOT_BASE } from "@/lib/game/engine/commands";
import { SPAWNER_INTERVAL_SECONDS, SPAWNER_LOCAL_CAP } from "@/lib/game/config";
import { GameEngine } from "@/lib/game/engine/GameEngine";
import { daylightAt } from "@/lib/game/engine/systems/dayNight";
import { fillDungeonChestIfUnlooted } from "@/lib/game/engine/systems/dungeon";
import { tickSpawnerDirector } from "@/lib/game/engine/systems/spawnDirector";
import type { FrameInput } from "@/lib/game/engine/state";
import type { MobKind } from "@/lib/game/types";

/**
 * Headless simulation tests: the engine boots a real generated world and runs
 * real frames without React, Three.js rendering, or a DOM.
 */

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeEngine(save: ReturnType<GameEngine["serialize"]> | null = null): GameEngine {
  return new GameEngine({ save, seed: 1337, rng: mulberry32(42), worldSize: { x: 64, y: 150, z: 64 } });
}

function input(overrides: Partial<{ keys: string[]; capsActive: boolean; leftMouseHeld: boolean; pointerLocked: boolean }> = {}): FrameInput {
  return {
    keys: new Set(overrides.keys ?? []),
    capsActive: overrides.capsActive ?? false,
    leftMouseHeld: overrides.leftMouseHeld ?? false,
    pointerLocked: overrides.pointerLocked ?? false
  };
}

function run(engine: GameEngine, seconds: number, frame: FrameInput = input()): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) engine.step(dt, frame);
}

/**
 * The world boots at dawn (daylight 0.05), so the initial hostiles aggro
 * immediately. Tests about other mechanics clear them and move to midday.
 */
function calmDaytime(engine: GameEngine): void {
  engine.state.mobs = engine.state.mobs.filter((mob) => !mob.hostile);
  engine.state.dayClock = 60;
}

describe("boot", () => {
  test("fresh engine spawns the player on safe ground with starter gear and mobs", () => {
    const engine = makeEngine();
    const { state } = engine;
    expect(collidesAt(state.world, state.player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT)).toBe(false);
    expect(state.player.position.y).toBeGreaterThan(2);
    expect(state.mobs.length).toBe(6 + 5 + 3 + 8 + 6 + 6);
    expect(countsById(state.inventory).get("wood")).toBe(64);
    expect(engine.getSnapshot().hearts).toBe(MAX_HEARTS);
    expect(engine.getSnapshot().passiveCount).toBe(14);
    expect(engine.getSnapshot().hostileCount).toBe(20);
  });

  test("the player settles onto the ground under gravity and stays put", () => {
    const engine = makeEngine();
    // Combat-free: with the rebalanced worldgen a hostile can spawn next to
    // the player and its hit knockback would masquerade as physics drift.
    calmDaytime(engine);
    run(engine, 2);
    const y1 = engine.state.player.position.y;
    run(engine, 1);
    expect(engine.state.player.position.y).toBeCloseTo(y1, 5);
    expect(engine.state.player.onGround).toBe(true);
  });

  test("light is baked at load: open sky is lit, solid ground is dark, no block light yet", () => {
    const { world } = makeEngine().state;
    const cx = Math.floor(world.sizeX / 2);
    const cz = Math.floor(world.sizeZ / 2);
    // The top of the world is open air, fully sky-lit.
    expect(world.getSky(cx, world.sizeY - 1, cz)).toBe(15);
    // Any solid block is sealed off from the sky and reads dark.
    const surfaceY = world.highestSolidY(cx, cz);
    expect(world.isSolid(cx, surfaceY, cz)).toBe(true);
    expect(world.getSky(cx, surfaceY, cz)).toBe(0);
    // Phase 1 has no emitters, so block light is entirely unlit.
    expect(world.light.some((v) => (v & 0x0f) !== 0)).toBe(false);
  });

  test("block edits relight locally: placing darkens the cell, mining restores sky", () => {
    const { state } = makeEngine();
    const { world } = state;
    const cx = Math.floor(world.sizeX / 2);
    const cz = Math.floor(world.sizeZ / 2);
    const y = world.sizeY - 5; // open air near the top of the world
    expect(world.getSky(cx, y, cz)).toBe(15);
    state.blockChanges.set(cx, y, cz, BlockId.Stone);
    expect(world.getSky(cx, y, cz)).toBe(0); // a solid block is opaque to sky
    state.blockChanges.set(cx, y, cz, BlockId.Air);
    expect(world.getSky(cx, y, cz)).toBe(15); // reopened to the sky
  });

  test("placing a torch emits block light into the neighborhood", () => {
    const { state } = makeEngine();
    const { world } = state;
    const cx = Math.floor(world.sizeX / 2);
    const cz = Math.floor(world.sizeZ / 2);
    const y = world.sizeY - 5; // open air; block light is independent of the sky
    expect(world.getBlockLight(cx, y, cz)).toBe(0);
    state.blockChanges.set(cx, y, cz, BlockId.Torch);
    expect(world.getBlockLight(cx, y, cz)).toBe(14);
    expect(world.getBlockLight(cx + 1, y, cz)).toBe(13);
  });
});

describe("movement and stats", () => {
  test("walking moves the player and never drains hunger below the walk budget rate", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    const startX = engine.state.player.position.x;
    const startZ = engine.state.player.position.z;
    run(engine, 2, input({ keys: ["KeyW"] }));
    const moved = Math.hypot(engine.state.player.position.x - startX, engine.state.player.position.z - startZ);
    expect(moved).toBeGreaterThan(3);
  });

  test("sprinting drains hunger with distance", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    expect(engine.state.hunger).toBe(MAX_HUNGER);
    // The 64-block test world is smaller than one full drain interval, so
    // pre-seed the budget and sprint the last stretch.
    engine.state.timers.sprintDistanceBudget = SPRINT_BLOCKS_PER_HUNGER - 10;
    // Space held: the player hops over one-block terrain rises while sprinting.
    run(engine, 4, input({ keys: ["KeyW", "Space"], capsActive: true }));
    expect(engine.state.hunger).toBeLessThan(MAX_HUNGER);
  });

  test("sprint is blocked at low hunger", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    engine.state.hunger = SPRINT_MIN_HUNGER;
    engine.state.timers.sprintDistanceBudget = SPRINT_BLOCKS_PER_HUNGER - 1;
    run(engine, 2, input({ keys: ["KeyW", "Space"], capsActive: true }));
    // No sprint drain fired: movement counted as walking instead.
    expect(engine.state.hunger).toBe(SPRINT_MIN_HUNGER);
    expect(engine.state.timers.sprintDistanceBudget).toBe(SPRINT_BLOCKS_PER_HUNGER - 1);
  });

  test("a barely-qualifying hard fall deals at least one damage", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1); // settle on the ground
    const { state } = engine;
    const groundY = state.player.position.y;
    // ~3.95 blocks of free fall lands at vy ≈ -14.3..-14.8 — inside the
    // damage window but where the scaled value floors to 0 without the clamp.
    state.player.position.y = groundY + 3.95;
    state.player.velocity.set(0, 0, 0);
    state.player.onGround = false;
    run(engine, 1);
    expect(engine.state.hearts).toBeLessThan(MAX_HEARTS);
  });

  test("hearts regenerate one per interval while hurt", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    engine.state.hearts = MAX_HEARTS - 3;
    run(engine, 3.2);
    expect(engine.state.hearts).toBe(MAX_HEARTS - 2);
    run(engine, 6.5);
    expect(engine.state.hearts).toBe(MAX_HEARTS);
  });

  test("health regen stops when hunger is too low", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    engine.state.hearts = MAX_HEARTS - 3;
    engine.state.hunger = REGEN_MIN_HUNGER - 1;
    run(engine, 6.5);
    expect(engine.state.hearts).toBe(MAX_HEARTS - 3);
  });

  test("continuous water exposure damages 1.5 hearts per second after one minute", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    engine.state.mobs = [];
    run(engine, 1);
    const { state } = engine;
    const x = Math.floor(state.player.position.x);
    const y = Math.floor(state.player.position.y + PLAYER_HEIGHT * 0.5);
    const z = Math.floor(state.player.position.z);
    state.blockChanges.set(x, y, z, BlockId.Water);
    const armorSlot = state.inventory.findIndex((slot) => !slot.id);
    state.inventory = [...state.inventory];
    state.inventory[armorSlot] = createSlot("chestplate", 1);
    state.equippedArmor.chestplate = "chestplate";
    const durability = state.inventory[armorSlot].durability;
    state.timers.waterExposureTimer = WATER_DAMAGE_DELAY_SECONDS - 0.5;
    engine.consumeEvents();

    run(engine, 0.4);
    expect(state.hearts).toBe(MAX_HEARTS);
    run(engine, 1.2);
    expect(state.hearts).toBe(MAX_HEARTS - WATER_DAMAGE_HP);
    expect(state.inventory[armorSlot].durability).toBe(durability);
    expect(engine.consumeEvents().some((event) => event.type === "playerHurt")).toBe(true);
  });

  test("leaving water resets both exposure counters", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    engine.state.mobs = [];
    run(engine, 1);
    const { state } = engine;
    const x = Math.floor(state.player.position.x);
    const y = Math.floor(state.player.position.y + PLAYER_HEIGHT * 0.5);
    const z = Math.floor(state.player.position.z);
    state.blockChanges.set(x, y, z, BlockId.Water);
    state.timers.waterExposureTimer = 42;
    state.timers.waterDamageTimer = 0.8;
    state.blockChanges.set(x, y, z, BlockId.Air);

    engine.step(0.1, input());
    expect(state.timers.waterExposureTimer).toBe(0);
    expect(state.timers.waterDamageTimer).toBe(0);
  });
});

describe("mining", () => {
  test("holding the mouse on the block underfoot eventually breaks it and yields its drop", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1); // settle
    const { state } = engine;
    const px = Math.floor(state.player.position.x);
    const py = Math.floor(state.player.position.y) - 1;
    const pz = Math.floor(state.player.position.z);
    const targetBlock = state.world.get(px, py, pz);
    expect(targetBlock).not.toBe(BlockId.Air);

    // Center the player in the cell: a ray origin exactly on a cell boundary
    // is ambiguous in the DDA and may target the diagonal neighbor.
    state.player.position.x = px + 0.5;
    state.player.position.z = pz + 0.5;
    state.player.pitch = -Math.PI / 2 + 0.02; // look straight down
    const before = countsById(state.inventory);
    run(engine, 4, input({ leftMouseHeld: true, pointerLocked: true }));

    expect(state.world.get(px, py, pz)).toBe(BlockId.Air);
    const after = countsById(state.inventory);
    // The broken block (grass/dirt/sand/...) maps to a drop that increments.
    const gained = [...after.entries()].some(([id, count]) => count > (before.get(id) ?? 0));
    expect(gained).toBe(true);
    expect(state.blockChanges.changes().length).toBeGreaterThan(0);
  });

  test("mining is gated on pointer lock and the inventory being closed", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    engine.state.player.pitch = -Math.PI / 2 + 0.02;
    run(engine, 4, input({ leftMouseHeld: true, pointerLocked: false }));
    expect(engine.state.blockChanges.changes().length).toBe(0);
  });
});

describe("chests", () => {
  /** Settles the player, centers it in its cell, and aims straight down at the floor block. */
  function aimDownAtFloor(engine: GameEngine): { x: number; y: number; z: number; idx: number } {
    calmDaytime(engine);
    engine.state.mobs = [];
    run(engine, 1);
    const { state } = engine;
    const x = Math.floor(state.player.position.x);
    const y = Math.floor(state.player.position.y) - 1;
    const z = Math.floor(state.player.position.z);
    state.player.position.x = x + 0.5;
    state.player.position.z = z + 0.5;
    state.player.pitch = -Math.PI / 2 + 0.02;
    return { x, y, z, idx: state.world.index(x, y, z) };
  }

  test("placing a chest creates an empty container at its voxel index", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    const { state } = engine;
    const ex = Math.floor(state.player.position.x);
    const ez = Math.floor(state.player.position.z);
    state.player.position.x = ex + 0.5;
    state.player.position.z = ez + 0.5;
    state.player.yaw = 0; // looking -Z
    state.player.pitch = 0;
    const ey = Math.floor(state.player.position.y + EYE_HEIGHT);
    state.blockChanges.set(ex, ey, ez - 1, BlockId.Air);
    state.blockChanges.set(ex, ey, ez - 2, BlockId.Air);
    state.blockChanges.set(ex, ey, ez - 3, BlockId.Stone);
    state.inventory = [...state.inventory];
    state.inventory[state.selectedSlot] = createSlot("chest", 1);

    engine.dispatch({ type: "placeBlock" });

    expect(state.world.get(ex, ey, ez - 2)).toBe(BlockId.Chest);
    const container = state.containers.get(state.world.index(ex, ey, ez - 2));
    expect(container).toBeDefined();
    expect(container).toHaveLength(CHEST_SLOTS);
    expect(container!.every((slot) => slot.id === null)).toBe(true);
  });

  test("right-clicking a chest opens it in the inventory panel", () => {
    const engine = makeEngine();
    const { idx } = aimDownAtFloor(engine);
    const { state } = engine;
    state.blockChanges.set(...indexToXYZ(state, idx), BlockId.Chest);

    engine.dispatch({ type: "placeBlock" }); // right-click → interact wins over place

    expect(state.openContainerIndex).toBe(idx);
    expect(state.inventoryOpen).toBe(true);
    expect(engine.getSnapshot().container).toHaveLength(CHEST_SLOTS);
  });

  test("moveStack moves an item between inventory and the open chest, and back", () => {
    const engine = makeEngine();
    const idx = 5000;
    engine.state.containers.set(
      idx,
      Array.from({ length: CHEST_SLOTS }, () => createEmptySlot())
    );
    engine.state.openContainerIndex = idx;
    engine.state.inventoryOpen = true;
    engine.state.inventory = [...engine.state.inventory];
    engine.state.inventory[0] = createSlot("dirt", 10);

    engine.dispatch({ type: "moveStack", from: 0, to: CONTAINER_SLOT_BASE + 0 });
    expect(engine.state.inventory[0].id).toBeNull();
    expect(engine.state.containers.get(idx)![0].id).toBe("dirt");
    expect(engine.state.containers.get(idx)![0].count).toBe(10);

    engine.dispatch({ type: "moveStack", from: CONTAINER_SLOT_BASE + 0, to: 0 });
    expect(engine.state.inventory[0].id).toBe("dirt");
    expect(engine.state.containers.get(idx)![0].id).toBeNull();
  });

  test("moveStack within the player inventory leaves the open chest untouched", () => {
    const engine = makeEngine();
    const idx = 5000;
    engine.state.containers.set(
      idx,
      Array.from({ length: CHEST_SLOTS }, () => createEmptySlot())
    );
    engine.state.openContainerIndex = idx;
    engine.state.inventoryOpen = true;
    engine.state.inventory = [...engine.state.inventory];
    engine.state.inventory[0] = createSlot("dirt", 4);
    engine.state.inventory[1] = createEmptySlot();

    // Rearranging the player inventory while a chest is open must not write into
    // the container (regression: the second write-back used to misroute here).
    engine.dispatch({ type: "moveStack", from: 0, to: 1 });

    expect(engine.state.inventory[1].id).toBe("dirt");
    expect(engine.state.inventory[0].id).toBeNull();
    expect(engine.state.containers.get(idx)!.every((slot) => slot.id === null)).toBe(true);
  });

  test("closing the inventory clears the open chest", () => {
    const engine = makeEngine();
    engine.state.containers.set(
      5000,
      Array.from({ length: CHEST_SLOTS }, () => createEmptySlot())
    );
    engine.state.openContainerIndex = 5000;
    engine.state.inventoryOpen = true;
    engine.dispatch({ type: "toggleInventory" }); // closes
    expect(engine.state.inventoryOpen).toBe(false);
    expect(engine.state.openContainerIndex).toBeNull();
    expect(engine.getSnapshot().container).toBeNull();
  });

  test("breaking an empty chest drops the chest item and removes its container", () => {
    const engine = makeEngine();
    const { idx } = aimDownAtFloor(engine);
    const { state } = engine;
    state.blockChanges.set(...indexToXYZ(state, idx), BlockId.Chest);
    state.containers.set(
      idx,
      Array.from({ length: CHEST_SLOTS }, () => createEmptySlot())
    );

    run(engine, 4, input({ leftMouseHeld: true, pointerLocked: true }));

    expect(state.world.blocks[idx]).toBe(BlockId.Air);
    expect(state.containers.has(idx)).toBe(false);
    expect(countsById(state.inventory).get("chest")).toBe(1);
  });

  test("breaking a full chest spills its contents into the inventory", () => {
    const engine = makeEngine();
    const { idx } = aimDownAtFloor(engine);
    const { state } = engine;
    state.blockChanges.set(...indexToXYZ(state, idx), BlockId.Chest);
    const slots = Array.from({ length: CHEST_SLOTS }, () => createEmptySlot());
    slots[0] = createSlot("diamond_ore", 7);
    state.containers.set(idx, slots);
    engine.consumeEvents();

    run(engine, 4, input({ leftMouseHeld: true, pointerLocked: true }));

    expect(state.world.blocks[idx]).toBe(BlockId.Air);
    expect(state.containers.has(idx)).toBe(false);
    expect(countsById(state.inventory).get("diamond_ore")).toBe(7);
  });

  test("a full chest refuses to break into a full inventory, staying intact", () => {
    const engine = makeEngine();
    const { idx } = aimDownAtFloor(engine);
    const { state } = engine;
    state.blockChanges.set(...indexToXYZ(state, idx), BlockId.Chest);
    const slots = Array.from({ length: CHEST_SLOTS }, () => createEmptySlot());
    slots[0] = createSlot("dirt", 5);
    state.containers.set(idx, slots);
    // Fill every inventory slot so the spill cannot land anywhere.
    state.inventory = Array.from({ length: state.inventory.length }, () => createSlot("stone", 99));
    engine.consumeEvents();

    run(engine, 4, input({ leftMouseHeld: true, pointerLocked: true }));
    const events = engine.consumeEvents();

    expect(state.world.blocks[idx]).toBe(BlockId.Chest); // not broken
    expect(state.containers.get(idx)![0].id).toBe("dirt"); // contents kept
    expect(events.some((event) => event.type === "breakBlocked")).toBe(true);
  });

  test("chest contents survive a save round-trip", () => {
    const engine = makeEngine();
    const idx = engine.state.world.index(20, 40, 20);
    engine.state.blockChanges.set(20, 40, 20, BlockId.Chest);
    const slots = Array.from({ length: CHEST_SLOTS }, () => createEmptySlot());
    slots[0] = createSlot("gold_ore", 3);
    slots[1] = { ...createSlot("diamond_sword", 1), durability: 200 };
    engine.state.containers.set(idx, slots);

    const restored = makeEngine(engine.serialize());
    const container = restored.state.containers.get(idx);
    expect(container).toBeDefined();
    expect(container![0].id).toBe("gold_ore");
    expect(container![0].count).toBe(3);
    expect(container![1].durability).toBe(200);
  });

  // ── Dungeon loot chests ────────────────────────────────────────────────
  // The small 64³ test world places no dungeons (every candidate falls inside
  // the spawn-clearance radius), so these inject a dungeon chest by hand.

  test("a dungeon chest fills with loot once on first access, then never again", () => {
    const engine = makeEngine();
    const idx = engine.state.world.index(22, 40, 22);
    engine.state.dungeonChestIndices.add(idx);

    fillDungeonChestIfUnlooted(engine.state, idx);
    expect(engine.state.lootedDungeonChests.has(idx)).toBe(true);
    expect(engine.state.containers.get(idx)!.some((slot) => slot.id && slot.count > 0)).toBe(true);

    // Emptying it and re-accessing must not re-roll: the looted set is the gate.
    engine.state.containers.set(
      idx,
      Array.from({ length: CHEST_SLOTS }, () => createEmptySlot())
    );
    fillDungeonChestIfUnlooted(engine.state, idx);
    expect(engine.state.containers.get(idx)!.some((slot) => slot.id && slot.count > 0)).toBe(false);
  });

  test("a looted dungeon chest never re-rolls after a reload (exploit closed)", () => {
    const engine = makeEngine();
    const idx = engine.state.world.index(20, 40, 20);
    engine.state.blockChanges.set(20, 40, 20, BlockId.Chest);
    engine.state.dungeonChestIndices.add(idx);

    fillDungeonChestIfUnlooted(engine.state, idx); // first open → loot + marked looted
    expect(engine.state.containers.get(idx)!.some((slot) => slot.id && slot.count > 0)).toBe(true);
    // Player loots everything; the now-empty container drops out of the save.
    engine.state.containers.set(
      idx,
      Array.from({ length: CHEST_SLOTS }, () => createEmptySlot())
    );

    const restored = makeEngine(engine.serialize());
    // The reload re-derives dungeon sites from the seed; this hand-injected chest
    // would normally be among them, so simulate that — the point under test is
    // that the *persisted looted set*, not the chest's emptiness, blocks re-roll.
    restored.state.dungeonChestIndices.add(idx);
    expect(restored.state.lootedDungeonChests.has(idx)).toBe(true);

    fillDungeonChestIfUnlooted(restored.state, idx);
    const after = restored.state.containers.get(idx) ?? [];
    expect(after.some((slot) => slot.id && slot.count > 0)).toBe(false);
  });

  test("breaking an unopened dungeon chest still yields its loot", () => {
    const engine = makeEngine();
    const { idx } = aimDownAtFloor(engine);
    const { state } = engine;
    state.blockChanges.set(...indexToXYZ(state, idx), BlockId.Chest);
    state.dungeonChestIndices.add(idx);
    state.inventory = Array.from({ length: state.inventory.length }, () => createEmptySlot()); // room to receive
    engine.consumeEvents();

    run(engine, 4, input({ leftMouseHeld: true, pointerLocked: true }));

    expect(state.world.blocks[idx]).toBe(BlockId.Air);
    expect(state.lootedDungeonChests.has(idx)).toBe(true);
    expect(countsById(state.inventory).get("chest")).toBe(1); // the chest item itself
    expect(countsById(state.inventory).get("bone") ?? 0).toBeGreaterThan(0); // bone always drops
  });
});

describe("dungeon spawners", () => {
  /** Registers a spawner block near the player and returns its voxel index. */
  function placeSpawner(engine: GameEngine, offsetX = 0, offsetZ = 0): number {
    const { state } = engine;
    state.mobs = [];
    const sx = 30 + offsetX;
    const sz = 30 + offsetZ;
    const sy = state.world.highestSolidY(sx, sz) + 1;
    state.blockChanges.set(sx, sy, sz, BlockId.Spawner);
    const idx = state.world.index(sx, sy, sz);
    state.dungeonSpawnerIndices.add(idx);
    return idx;
  }

  test("a nearby spawner drips hostiles up to the local cap, emitting spawn events", () => {
    const engine = makeEngine();
    const { state } = engine;
    const idx = placeSpawner(engine);
    const [sx, sy, sz] = indexToXYZ(state, idx);
    state.player.position.set(sx + 1, sy, sz + 1); // inside the activation radius

    const rng = mulberry32(7);
    let spawnEvents = 0;
    // Each ready interval spawns at most one per spawner; over-fire to hit the cap.
    for (let i = 0; i < 20; i += 1) {
      tickSpawnerDirector(state, SPAWNER_INTERVAL_SECONDS, rng, (event) => {
        if (event.type === "mobSpawned") spawnEvents += 1;
      });
    }

    const hostiles = state.mobs.filter((mob) => mob.hostile).length;
    expect(hostiles).toBe(SPAWNER_LOCAL_CAP);
    expect(spawnEvents).toBe(SPAWNER_LOCAL_CAP);
  });

  test("a spawner is inert when the player is out of range", () => {
    const engine = makeEngine();
    const { state } = engine;
    const idx = placeSpawner(engine);
    const [sx, sy, sz] = indexToXYZ(state, idx);
    state.player.position.set(sx + 40, sy, sz + 40); // well outside the activation radius

    const rng = mulberry32(7);
    for (let i = 0; i < 10; i += 1) tickSpawnerDirector(state, SPAWNER_INTERVAL_SECONDS, rng, () => {});

    expect(state.mobs.length).toBe(0);
  });

  test("a mined-out spawner stops spawning", () => {
    const engine = makeEngine();
    const { state } = engine;
    const idx = placeSpawner(engine);
    const [sx, sy, sz] = indexToXYZ(state, idx);
    state.player.position.set(sx + 1, sy, sz + 1);
    state.blockChanges.set(sx, sy, sz, BlockId.Air); // the block is gone, index still registered

    const rng = mulberry32(7);
    for (let i = 0; i < 10; i += 1) tickSpawnerDirector(state, SPAWNER_INTERVAL_SECONDS, rng, () => {});

    expect(state.mobs.length).toBe(0);
  });
});

describe("doors", () => {
  function setAimedDoor(engine: GameEngine, open = false): { x: number; y: number; z: number } {
    calmDaytime(engine);
    engine.state.mobs = [];
    run(engine, 1);
    const { state } = engine;
    const x = Math.floor(state.player.position.x);
    const z = Math.floor(state.player.position.z) - 1;
    const y = Math.floor(state.player.position.y + EYE_HEIGHT);
    state.player.position.x = x + 0.5;
    state.player.position.z = z + 1.5;
    state.player.yaw = 0;
    state.player.pitch = 0;
    state.blockChanges.set(x, y, z, open ? BlockId.DoorNorthOpenLower : BlockId.DoorNorthLower);
    state.blockChanges.set(x, y + 1, z, open ? BlockId.DoorNorthOpenUpper : BlockId.DoorNorthUpper);
    return { x, y, z };
  }

  test("right-clicking either half toggles both halves", () => {
    const engine = makeEngine();
    const door = setAimedDoor(engine);
    engine.consumeEvents();
    engine.dispatch({ type: "placeBlock" });
    expect(engine.state.world.get(door.x, door.y, door.z)).toBe(BlockId.DoorNorthOpenLower);
    expect(engine.state.world.get(door.x, door.y + 1, door.z)).toBe(BlockId.DoorNorthOpenUpper);
    expect(engine.consumeEvents()).toContainEqual({ type: "doorToggled", open: true });

    engine.dispatch({ type: "placeBlock" });
    expect(engine.state.world.get(door.x, door.y, door.z)).toBe(BlockId.DoorNorthLower);
    expect(engine.state.world.get(door.x, door.y + 1, door.z)).toBe(BlockId.DoorNorthUpper);
  });

  test("placing one door item creates a supported two-block door", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    engine.state.mobs = [];
    run(engine, 1);
    const { state } = engine;
    const x = Math.floor(state.player.position.x);
    const z = Math.floor(state.player.position.z);
    const floorY = Math.floor(state.player.position.y) - 1;
    state.player.position.set(x + 0.5, floorY + 1, z + 0.5);
    state.player.yaw = 0;
    state.player.pitch = -0.6;
    for (let dz = -1; dz >= -5; dz -= 1) {
      state.blockChanges.set(x, floorY, z + dz, BlockId.Stone);
      state.blockChanges.set(x, floorY + 1, z + dz, BlockId.Air);
      state.blockChanges.set(x, floorY + 2, z + dz, BlockId.Air);
    }
    state.inventory = [...state.inventory];
    state.inventory[state.selectedSlot] = createSlot("door", 1);

    engine.dispatch({ type: "placeBlock" });

    const placed: Array<{ y: number; block: number }> = [];
    for (let dz = -1; dz >= -5; dz -= 1) {
      for (let y = floorY + 1; y <= floorY + 2; y += 1) {
        const block = state.world.get(x, y, z + dz);
        if (block >= BlockId.DoorNorthLower && block <= BlockId.DoorWestOpenUpper) placed.push({ y, block });
      }
    }
    expect(placed).toHaveLength(2);
    expect(placed[0].block).toBe(BlockId.DoorNorthLower);
    expect(placed[1].block).toBe(BlockId.DoorNorthUpper);
    expect(state.inventory[state.selectedSlot].id).toBeNull();
  });

  test("breaking either half removes the whole door and drops one item", () => {
    const engine = makeEngine();
    const door = setAimedDoor(engine);
    const before = countsById(engine.state.inventory).get("door") ?? 0;
    run(engine, 5, input({ leftMouseHeld: true, pointerLocked: true }));
    expect(engine.state.world.get(door.x, door.y, door.z)).toBe(BlockId.Air);
    expect(engine.state.world.get(door.x, door.y + 1, door.z)).toBe(BlockId.Air);
    expect(countsById(engine.state.inventory).get("door")).toBe(before + 1);
  });

  test("door state persists through the ordinary block-change save", () => {
    const engine = makeEngine();
    const door = setAimedDoor(engine, true);
    const restored = makeEngine(engine.serialize());
    expect(restored.state.world.get(door.x, door.y, door.z)).toBe(BlockId.DoorNorthOpenLower);
    expect(restored.state.world.get(door.x, door.y + 1, door.z)).toBe(BlockId.DoorNorthOpenUpper);
  });

  test("mobs cannot toggle a door and stop at its closed panel", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    const { state } = engine;
    const mob = state.mobs.find((entry) => !entry.hostile)!;
    const ground = 30;
    state.player.position.set(50, ground, 50);
    for (let z = 19; z <= 22; z += 1) {
      for (let y = ground; y < state.world.sizeY; y += 1) state.blockChanges.set(20, y, z, BlockId.Air);
      state.blockChanges.set(20, ground - 1, z, BlockId.Stone);
    }
    mob.position.set(20.5, ground + mob.halfHeight, 21.1);
    mob.direction.set(0, 0, -1);
    mob.turnTimer = 10;
    state.blockChanges.set(20, ground, 20, BlockId.DoorNorthLower);
    state.blockChanges.set(20, ground + 1, 20, BlockId.DoorNorthUpper);
    const beforeZ = mob.position.z;
    engine.step(0.5, input());
    expect(mob.position.z).toBe(beforeZ);
    expect(state.world.get(20, ground, 20)).toBe(BlockId.DoorNorthLower);
    expect(state.world.get(20, ground + 1, 20)).toBe(BlockId.DoorNorthUpper);
  });
});

/** Decodes a voxel index back to [x, y, z] for the active world. */
function indexToXYZ(state: GameEngine["state"], idx: number): [number, number, number] {
  const layer = state.world.sizeX * state.world.sizeZ;
  const y = Math.floor(idx / layer);
  const rem = idx - y * layer;
  const z = Math.floor(rem / state.world.sizeX);
  const x = rem - z * state.world.sizeX;
  return [x, y, z];
}

describe("commands", () => {
  test("selectSlot clamps to the hotbar", () => {
    const engine = makeEngine();
    engine.dispatch({ type: "selectSlot", index: 3 });
    expect(engine.getSnapshot().selectedSlot).toBe(3);
    engine.dispatch({ type: "selectSlot", index: 99 });
    expect(engine.getSnapshot().selectedSlot).toBe(3);
  });

  test("craft consumes cost and produces the result", () => {
    const engine = makeEngine();
    const woodBefore = countsById(engine.state.inventory).get("wood")!;
    engine.dispatch({ type: "craft", recipeId: "planks" });
    const counts = countsById(engine.state.inventory);
    expect(counts.get("wood")).toBe(woodBefore - 2);
    expect(counts.get("planks")).toBe(20 + 4);
  });

  test("snapshot identity only changes when visible state changes", () => {
    const engine = makeEngine();
    const snap1 = engine.getSnapshot();
    engine.dispatch({ type: "selectSlot", index: 0 }); // already 0 — no change
    expect(engine.getSnapshot()).toBe(snap1);
    engine.dispatch({ type: "selectSlot", index: 2 });
    expect(engine.getSnapshot()).not.toBe(snap1);
  });

  test("toggleInventory flips the panel and blocks placement", () => {
    const engine = makeEngine();
    engine.dispatch({ type: "toggleInventory" });
    expect(engine.getSnapshot().inventoryOpen).toBe(true);
    engine.dispatch({ type: "toggleInventory" });
    expect(engine.getSnapshot().inventoryOpen).toBe(false);
  });

  test("pause freezes the simulation and resume unfreezes it", () => {
    const engine = makeEngine();
    run(engine, 1);
    engine.dispatch({ type: "pause" });
    expect(engine.getSnapshot().paused).toBe(true);

    const clockBefore = engine.state.dayClock;
    const mobPositions = engine.state.mobs.map((mob) => mob.position.clone());
    run(engine, 1, input({ keys: ["KeyW"] }));
    expect(engine.state.dayClock).toBe(clockBefore);
    expect(engine.state.mobs.every((mob, i) => mob.position.equals(mobPositions[i]))).toBe(true);

    engine.dispatch({ type: "resume" });
    expect(engine.getSnapshot().paused).toBe(false);
    run(engine, 0.5);
    expect(engine.state.dayClock).toBeGreaterThan(clockBefore);
  });

  test("pause is ignored while the inventory is open or the player is dead", () => {
    const engine = makeEngine();
    engine.dispatch({ type: "toggleInventory" });
    engine.dispatch({ type: "pause" });
    expect(engine.getSnapshot().paused).toBe(false);
    engine.dispatch({ type: "toggleInventory" });

    engine.state.isDead = true;
    engine.dispatch({ type: "pause" });
    expect(engine.getSnapshot().paused).toBe(false);
  });

  test("toggleDebug flips the overlay and publishes a throttled readout", () => {
    const engine = makeEngine();
    engine.dispatch({ type: "toggleDebug" });
    expect(engine.getSnapshot().debugOpen).toBe(true);
    expect(engine.getSnapshot().debug).not.toBeNull();
    expect(engine.getSnapshot().debug!.y).toBeCloseTo(engine.state.player.position.y, 0);
    engine.dispatch({ type: "toggleDebug" });
    expect(engine.getSnapshot().debugOpen).toBe(false);
    expect(engine.getSnapshot().debug).toBeNull();
  });

  test("toggleCameraView cycles first → third-rear → third-front → first", () => {
    const engine = makeEngine();
    expect(engine.getSnapshot().cameraMode).toBe("first");
    engine.dispatch({ type: "toggleCameraView" });
    expect(engine.getSnapshot().cameraMode).toBe("third-rear");
    engine.dispatch({ type: "toggleCameraView" });
    expect(engine.getSnapshot().cameraMode).toBe("third-front");
    engine.dispatch({ type: "toggleCameraView" });
    expect(engine.getSnapshot().cameraMode).toBe("first");
  });

  test("camera mode works while dead and is never persisted", () => {
    const engine = makeEngine();
    engine.state.isDead = true;
    engine.dispatch({ type: "toggleCameraView" });
    expect(engine.getSnapshot().cameraMode).toBe("third-rear");
    expect("cameraMode" in engine.serialize()).toBe(false);
  });

  test("respawn command skips the countdown and restores full stats", () => {
    const engine = makeEngine();
    calmDaytime(engine); // hostiles at dawn could re-kill the fresh respawn
    run(engine, 0.5);
    engine.state.hunger = 5;
    engine.state.hearts = 1;
    engine.state.player.position.y = -10;
    run(engine, 0.5); // void tick kills
    expect(engine.state.isDead).toBe(true);
    expect(engine.getSnapshot().respawnSeconds).toBeGreaterThan(1);

    engine.dispatch({ type: "respawn" });
    run(engine, 0.1);
    expect(engine.state.isDead).toBe(false);
    expect(engine.state.hearts).toBe(MAX_HEARTS);
    expect(engine.state.hunger).toBe(MAX_HUNGER);
  });

  test("armorPoints reflects equipped defense", () => {
    const engine = makeEngine();
    expect(engine.getSnapshot().armorPoints).toBe(0);
    const slot = engine.state.inventory.findIndex((entry) => !entry.id);
    engine.state.inventory = [...engine.state.inventory];
    engine.state.inventory[slot] = createSlot("helmet", 1);
    engine.dispatch({ type: "toggleEquipArmor", index: slot });
    expect(engine.getSnapshot().armorPoints).toBeGreaterThan(0);
  });
});

describe("death and respawn", () => {
  test("void damage kills, the respawn countdown runs, and the player returns at full health", () => {
    const engine = makeEngine();
    calmDaytime(engine); // hostiles at dawn could damage the fresh respawn
    run(engine, 0.5);
    // One void tick (0.4s) must kill before the 0.8s auto-unstuck teleport fires.
    engine.state.hearts = 1;
    engine.state.player.position.y = -10; // into the void

    run(engine, 2);
    expect(engine.state.isDead).toBe(true);
    expect(engine.consumeEvents().some((event) => event.type === "died")).toBe(true);
    expect(engine.getSnapshot().respawnSeconds).toBeGreaterThan(0);

    run(engine, 3.5);
    expect(engine.state.isDead).toBe(false);
    expect(engine.state.hearts).toBe(MAX_HEARTS);
    expect(engine.state.player.position.y).toBeGreaterThan(0);
    expect(engine.consumeEvents().some((event) => event.type === "respawned")).toBe(true);
  });
});

describe("day-night and the spawn director", () => {
  test("hostiles trickle in at night when below the cap", () => {
    const engine = makeEngine();
    engine.state.mobs = engine.state.mobs.filter((mob) => !mob.hostile); // clear hostiles
    engine.state.dayClock = 180; // deep night
    run(engine, 12);
    expect(engine.state.daylight).toBeLessThan(0.28);
    expect(engine.getSnapshot().hostileCount).toBeGreaterThan(0);
  });

  test("no hostile spawning during the day", () => {
    const engine = makeEngine();
    engine.state.mobs = engine.state.mobs.filter((mob) => !mob.hostile);
    engine.state.dayClock = 60; // midday
    run(engine, 12);
    expect(engine.getSnapshot().hostileCount).toBe(0);
  });
});

describe("gameplay events", () => {
  /** Drops a stationary mob at an offset from the player (test-controlled stats). */
  function spawnTestMob(engine: GameEngine, kind: MobKind, hostile: boolean, offset: { x: number; y: number; z: number }): void {
    const { state } = engine;
    const p = state.player.position;
    state.mobs.push({
      id: state.nextMobId++,
      kind,
      hostile,
      hp: 50,
      position: new THREE.Vector3(p.x + offset.x, p.y + offset.y, p.z + offset.z),
      direction: new THREE.Vector3(0, 0, 1),
      yaw: 0,
      turnTimer: 9,
      speed: 0,
      moveSpeed: 0,
      detectRange: 12,
      attackDamage: 2,
      attackCooldown: 5,
      attackTimer: 0,
      halfHeight: 0.9,
      bobSeed: 0,
      fedTimer: 0,
      ageTimer: 0
    });
  }

  test("breaking a block emits blockBroken with the block id", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    const { state } = engine;
    const px = Math.floor(state.player.position.x);
    const py = Math.floor(state.player.position.y) - 1;
    const pz = Math.floor(state.player.position.z);
    const targetBlock = state.world.get(px, py, pz);
    state.player.position.x = px + 0.5;
    state.player.position.z = pz + 0.5;
    state.player.pitch = -Math.PI / 2 + 0.02;
    engine.consumeEvents();
    run(engine, 4, input({ leftMouseHeld: true, pointerLocked: true }));
    const events = engine.consumeEvents();
    expect(events.some((event) => event.type === "blockBroken" && event.blockId === targetBlock)).toBe(true);
  });

  test("placing a block emits blockPlaced with the block id", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    const { state } = engine;
    const ex = Math.floor(state.player.position.x);
    const ez = Math.floor(state.player.position.z);
    state.player.position.x = ex + 0.5;
    state.player.position.z = ez + 0.5;
    state.player.yaw = 0; // looking -Z
    state.player.pitch = 0;
    // A clear shooting lane at eye height ending in a stone backstop.
    const ey = Math.floor(state.player.position.y + EYE_HEIGHT);
    state.blockChanges.set(ex, ey, ez - 1, BlockId.Air);
    state.blockChanges.set(ex, ey, ez - 2, BlockId.Air);
    state.blockChanges.set(ex, ey, ez - 3, BlockId.Stone);
    engine.consumeEvents();
    engine.dispatch({ type: "placeBlock" }); // slot 0 holds grass blocks
    const events = engine.consumeEvents();
    expect(events.some((event) => event.type === "blockPlaced" && event.blockId === BlockId.Grass)).toBe(true);
    expect(state.world.get(ex, ey, ez - 2)).toBe(BlockId.Grass);
  });

  test("placing a block replaces the targeted water cell", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    const { state } = engine;
    const ex = Math.floor(state.player.position.x);
    const ez = Math.floor(state.player.position.z);
    state.player.position.x = ex + 0.5;
    state.player.position.z = ez + 0.5;
    state.player.yaw = 0;
    state.player.pitch = 0;
    const ey = Math.floor(state.player.position.y + EYE_HEIGHT);
    state.blockChanges.set(ex, ey, ez - 1, BlockId.Water);
    state.blockChanges.set(ex, ey, ez - 2, BlockId.Water);
    state.blockChanges.set(ex, ey, ez - 3, BlockId.Stone);

    engine.dispatch({ type: "placeBlock" });

    expect(state.world.get(ex, ey, ez - 2)).toBe(BlockId.Grass);
  });

  test("a refused self-overlapping placement restores the water cell", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    const { state } = engine;
    const ex = Math.floor(state.player.position.x);
    const ez = Math.floor(state.player.position.z);
    const ey = Math.floor(state.player.position.y + EYE_HEIGHT);
    state.player.position.x = ex + 0.5;
    state.player.position.z = ez + 0.5;
    state.player.yaw = 0;
    state.player.pitch = 0;
    state.blockChanges.set(ex, ey, ez, BlockId.Water);
    state.blockChanges.set(ex, ey, ez - 1, BlockId.Stone);
    const grassBefore = countsById(state.inventory).get("grass");

    engine.dispatch({ type: "placeBlock" });

    expect(state.world.get(ex, ey, ez)).toBe(BlockId.Water);
    expect(countsById(state.inventory).get("grass")).toBe(grassBefore);
  });

  test("eating emits ateFood", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    const { state } = engine;
    const slot = state.inventory.findIndex((entry) => !entry.id);
    state.inventory = [...state.inventory];
    state.inventory[slot] = createSlot("food", 2);
    state.selectedSlot = slot;
    state.hunger = 5;
    engine.consumeEvents();
    engine.dispatch({ type: "eatFood" });
    expect(engine.consumeEvents().some((event) => event.type === "ateFood")).toBe(true);
    expect(state.hunger).toBeGreaterThan(5);
  });

  test("eating a meat restores its own hunger value", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    const { state } = engine;
    const slot = state.inventory.findIndex((entry) => !entry.id);
    state.inventory = [...state.inventory];
    state.inventory[slot] = createSlot("raw_chicken", 1); // hunger 3
    state.selectedSlot = slot;
    state.hunger = 5;
    engine.dispatch({ type: "eatFood" });
    expect(state.hunger).toBe(8);
    expect(countsById(state.inventory).get("raw_chicken")).toBeUndefined();
  });

  test("killing a mob drops its loot and emits mobDied", () => {
    // rng 0 → every drop rolls its minimum count (zombie: 1 rotten flesh).
    const engine = new GameEngine({ seed: 1337, rng: () => 0, worldSize: { x: 64, y: 150, z: 64 } });
    calmDaytime(engine);
    run(engine, 1);
    const { state } = engine;
    state.mobs = [];
    state.player.yaw = 0;
    state.player.pitch = 0;
    spawnTestMob(engine, "zombie", true, { x: 0, y: EYE_HEIGHT, z: -2 });
    state.mobs[state.mobs.length - 1].hp = 1; // one fist hit (6 dmg) kills it
    const before = countsById(state.inventory).get("rotten_flesh") ?? 0;
    engine.consumeEvents();
    engine.dispatch({ type: "attack" });
    const events = engine.consumeEvents();
    expect(events.some((event) => event.type === "mobDied" && event.kind === "zombie")).toBe(true);
    expect(countsById(state.inventory).get("rotten_flesh")).toBe(before + 1);
    expect(events.some((event) => event.type === "pickedUp" && event.items.some((it) => it.itemId === "rotten_flesh"))).toBe(true);
  });

  test("jumping and touching down emit jumped and landed", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1); // settle
    engine.consumeEvents();
    engine.step(1 / 60, input({ keys: ["Space"] }));
    run(engine, 2); // rise and fall back down
    const events = engine.consumeEvents();
    expect(events.some((event) => event.type === "jumped")).toBe(true);
    expect(events.some((event) => event.type === "landed" && event.impact > 0)).toBe(true);
  });

  test("non-lethal damage emits playerHurt, not died", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    const { state } = engine;
    state.player.position.y += 5; // a hard but survivable fall
    state.player.velocity.set(0, 0, 0);
    state.player.onGround = false;
    engine.consumeEvents();
    run(engine, 1);
    const events = engine.consumeEvents();
    expect(events.some((event) => event.type === "playerHurt")).toBe(true);
    expect(events.some((event) => event.type === "died")).toBe(false);
    expect(state.hearts).toBeLessThan(MAX_HEARTS);
  });

  test("a hostile attacking the player emits mobAttacked", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    spawnTestMob(engine, "zombie", true, { x: 1.2, y: 0.9, z: 0 });
    engine.consumeEvents();
    run(engine, 0.3);
    const events = engine.consumeEvents();
    expect(events.some((event) => event.type === "mobAttacked" && event.kind === "zombie")).toBe(true);
    expect(events.some((event) => event.type === "playerHurt")).toBe(true);
  });

  test("mobs stay silent while the player is dead", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    const { state } = engine;
    state.isDead = true;
    state.respawnTimer = 5;
    spawnTestMob(engine, "zombie", true, { x: 1.2, y: 0.9, z: 0 });
    engine.consumeEvents();
    run(engine, 0.5); // mobs keep ticking through the respawn countdown
    expect(engine.consumeEvents().some((event) => event.type === "mobAttacked")).toBe(false);
  });

  test("hitting a mob emits mobHit with its kind", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    const { state } = engine;
    state.mobs = [];
    state.player.yaw = 0;
    state.player.pitch = 0;
    // Park a sheep dead ahead at eye height so the aim-dot check passes.
    spawnTestMob(engine, "sheep", false, { x: 0, y: EYE_HEIGHT, z: -2 });
    engine.consumeEvents();
    engine.dispatch({ type: "attack" });
    expect(engine.consumeEvents().some((event) => event.type === "mobHit" && event.kind === "sheep")).toBe(true);
  });

  test("spears hit farther than ordinary melee weapons", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    const { state } = engine;
    state.mobs = [];
    state.player.yaw = 0;
    state.player.pitch = 0;
    spawnTestMob(engine, "sheep", false, { x: 0, y: EYE_HEIGHT, z: -6 });
    const mob = state.mobs[state.mobs.length - 1];

    state.inventory[0] = createSlot("stone_sword", 1);
    state.selectedSlot = 0;
    engine.dispatch({ type: "attack" });
    expect(mob.hp).toBe(50);

    state.inventory[0] = createSlot("stone_spear", 1);
    engine.dispatch({ type: "attack" });
    expect(mob.hp).toBe(34);
  });

  test("right-click throws a spear that damages mobs and wears the weapon", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    const { state } = engine;
    state.mobs = [];
    state.player.yaw = 0;
    state.inventory[0] = createSlot("diamond_spear", 1);
    state.selectedSlot = 0;
    const durability = state.inventory[0].durability!;
    const targetDistance = 2;
    const targetZ = state.player.position.z - targetDistance;
    const targetY = state.world.highestSolidY(Math.floor(state.player.position.x), Math.floor(targetZ)) + 1.9;
    state.player.pitch = Math.atan2(targetY - (state.player.position.y + EYE_HEIGHT), targetDistance) + 0.01;
    spawnTestMob(engine, "zombie", false, { x: 0, y: targetY - state.player.position.y, z: -targetDistance });
    const mobId = state.mobs[state.mobs.length - 1].id;

    engine.dispatch({ type: "placeBlock" });
    expect(state.thrownSpears).toHaveLength(1);
    expect(state.inventory[0].durability).toBe(durability - 1);
    engine.dispatch({ type: "placeBlock" }); // cooldown prevents repeat spam
    expect(state.thrownSpears).toHaveLength(1);

    run(engine, 0.6);
    expect(state.thrownSpears).toHaveLength(0);
    expect(state.mobs.some((mob) => mob.id === mobId)).toBe(false);
    expect(engine.consumeEvents().some((event) => event.type === "mobHit" && event.kind === "zombie")).toBe(true);
  });

  test("a spear that hits terrain stays embedded for two seconds", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    const { state } = engine;
    state.mobs = [];
    state.inventory[0] = createSlot("wood_spear", 1);
    state.selectedSlot = 0;
    state.player.pitch = -Math.PI / 2 + 0.02;

    engine.dispatch({ type: "placeBlock" });
    run(engine, 0.2);
    expect(state.thrownSpears).toHaveLength(1);
    expect(state.thrownSpears[0].stuckTimer).not.toBeNull();

    run(engine, 1.7);
    expect(state.thrownSpears).toHaveLength(1);
    run(engine, 0.2);
    expect(state.thrownSpears).toHaveLength(0);
  });

  test("attacking emits attackSwung even when nothing is hit", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    engine.consumeEvents();
    engine.dispatch({ type: "attack" }); // empty air ahead
    const events = engine.consumeEvents();
    expect(events.some((event) => event.type === "attackSwung")).toBe(true);
    expect(events.some((event) => event.type === "mobHit")).toBe(false);
  });

  test("attacking emits no attackSwung while dead or in the inventory", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    const { state } = engine;
    state.inventoryOpen = true;
    engine.consumeEvents();
    engine.dispatch({ type: "attack" });
    expect(engine.consumeEvents().some((event) => event.type === "attackSwung")).toBe(false);

    state.inventoryOpen = false;
    state.isDead = true;
    engine.dispatch({ type: "attack" });
    expect(engine.consumeEvents().some((event) => event.type === "attackSwung")).toBe(false);
  });
});

describe("persistence", () => {
  test("serialize → boot round-trip restores edits, inventory, and position", () => {
    const engine = makeEngine();
    run(engine, 1);
    const { state } = engine;
    const px = Math.floor(state.player.position.x);
    const py = Math.floor(state.player.position.y) - 1;
    const pz = Math.floor(state.player.position.z);
    state.blockChanges.set(px, py + 5, pz, BlockId.Brick);
    engine.dispatch({ type: "selectSlot", index: 4 });
    engine.dispatch({ type: "craft", recipeId: "planks" });

    const save = engine.serialize();
    expect(save.changes.length).toBeGreaterThan(0);

    const restored = makeEngine(save);
    expect(restored.state.world.get(px, py + 5, pz)).toBe(BlockId.Brick);
    expect(restored.state.selectedSlot).toBe(4);
    expect(countsById(restored.state.inventory).get("planks")).toBe(24);
    expect(restored.state.player.position.x).toBeCloseTo(state.player.position.x, 3);
    expect(restored.state.player.position.y).toBeCloseTo(state.player.position.y, 3);
  });

  test("reverting an edit to its baseline removes the save delta", () => {
    const engine = makeEngine();
    const { state } = engine;
    const y = state.world.highestSolidY(30, 30);
    const original = state.world.get(30, y, 30);
    state.blockChanges.set(30, y, 30, BlockId.Air);
    expect(state.blockChanges.changes().length).toBe(1);
    state.blockChanges.set(30, y, 30, original as BlockId);
    expect(state.blockChanges.changes().length).toBe(0);
  });

  test("save format is version 5 and carries clock, stats, and spawn point", () => {
    const engine = makeEngine();
    engine.state.dayClock = 123;
    engine.state.hearts = 14;
    engine.state.hunger = 9;
    engine.state.spawnPoint = { x: 12, y: 40, z: 8 };
    const save = engine.serialize();
    expect(save.version).toBe(5);

    const restored = makeEngine(save);
    expect(restored.state.dayClock).toBe(123);
    expect(restored.state.hearts).toBe(14);
    expect(restored.state.hunger).toBe(9);
    expect(restored.state.spawnPoint).toEqual({ x: 12, y: 40, z: 8 });
    // Daylight is re-derived from the restored clock, not left at dawn.
    expect(restored.state.daylight).toBeCloseTo(daylightAt(123), 5);
  });
});

describe("beds and sleep", () => {
  /** Settles the player, then drops a bed block one cell ahead at eye height and aims at it. */
  function placeBedAhead(engine: GameEngine): { x: number; y: number; z: number } {
    run(engine, 1);
    const { state } = engine;
    const ex = Math.floor(state.player.position.x);
    const ez = Math.floor(state.player.position.z);
    state.player.position.x = ex + 0.5;
    state.player.position.z = ez + 0.5;
    state.player.yaw = 0; // looking -Z
    state.player.pitch = 0;
    const ey = Math.floor(state.player.position.y + EYE_HEIGHT);
    state.blockChanges.set(ex, ey, ez, BlockId.Air);
    state.blockChanges.set(ex, ey, ez - 1, BlockId.Bed);
    return { x: ex, y: ey, z: ez - 1 };
  }

  function pushHostile(engine: GameEngine, offset: { x: number; y: number; z: number }): void {
    const p = engine.state.player.position;
    engine.state.mobs.push({
      id: engine.state.nextMobId++,
      kind: "zombie",
      hostile: true,
      hp: 10,
      position: new THREE.Vector3(p.x + offset.x, p.y + offset.y, p.z + offset.z),
      direction: new THREE.Vector3(0, 0, 1),
      yaw: 0,
      turnTimer: 9,
      speed: 0,
      moveSpeed: 0,
      detectRange: 11,
      attackDamage: 3,
      attackCooldown: 1.35,
      attackTimer: 0,
      halfHeight: 0.9,
      bobSeed: 0,
      fedTimer: 0,
      ageTimer: 0
    });
  }

  test("crafting a bed consumes wool and planks", () => {
    const engine = makeEngine();
    const { state } = engine;
    const free = state.inventory.findIndex((entry) => !entry.id);
    state.inventory = [...state.inventory];
    state.inventory[free] = createSlot("wool", 3);
    const free2 = state.inventory.findIndex((entry) => !entry.id);
    state.inventory[free2] = createSlot("planks", 3);
    engine.dispatch({ type: "craft", recipeId: "bed" });
    expect(countsById(engine.state.inventory).get("bed")).toBe(1);
  });

  test("interacting with a bed at night skips to morning and sets the spawn point", () => {
    const engine = makeEngine();
    engine.state.mobs = engine.state.mobs.filter((mob) => !mob.hostile);
    engine.state.dayClock = 180; // deep night
    const bed = placeBedAhead(engine);
    engine.state.mobs = engine.state.mobs.filter((mob) => !mob.hostile); // none within sleep radius
    engine.consumeEvents();

    engine.dispatch({ type: "placeBlock" }); // right-click the bed
    expect(engine.consumeEvents().some((event) => event.type === "sleepStarted")).toBe(true);
    expect(engine.state.sleepTimer).toBeGreaterThan(0);
    expect(engine.getSnapshot().sleeping).toBe(true);
    expect(engine.state.spawnPoint).toEqual(bed);

    run(engine, 2); // let the fade complete and the clock jump
    expect(engine.state.sleepTimer).toBe(0);
    expect(engine.state.dayClock).toBeGreaterThan(DAY_CYCLE_SECONDS);
    expect(engine.state.daylight).toBeGreaterThan(0.28); // woke to morning
  });

  test("pausing is ignored while sleeping so the fade can't stall", () => {
    const engine = makeEngine();
    engine.state.dayClock = 180; // night
    engine.state.sleepTimer = 1.0; // mid-fade
    engine.dispatch({ type: "pause" });
    expect(engine.getSnapshot().paused).toBe(false); // pause refused during sleep
    run(engine, 1.2); // the fade completes and the clock jumps
    expect(engine.state.sleepTimer).toBe(0);
    expect(engine.state.dayClock).toBeGreaterThan(DAY_CYCLE_SECONDS);
  });

  test("a bed cannot be used during the day", () => {
    const engine = makeEngine();
    engine.state.mobs = engine.state.mobs.filter((mob) => !mob.hostile);
    engine.state.dayClock = 60; // midday
    placeBedAhead(engine);
    engine.consumeEvents();
    engine.dispatch({ type: "placeBlock" });
    const events = engine.consumeEvents();
    expect(events.some((event) => event.type === "sleepDenied" && event.reason === "daylight")).toBe(true);
    expect(engine.state.sleepTimer).toBe(0);
  });

  test("a bed cannot be used with a hostile nearby", () => {
    const engine = makeEngine();
    engine.state.mobs = engine.state.mobs.filter((mob) => !mob.hostile);
    engine.state.dayClock = 180;
    placeBedAhead(engine);
    engine.state.mobs = engine.state.mobs.filter((mob) => !mob.hostile);
    pushHostile(engine, { x: 3, y: 0, z: 0 }); // within SLEEP_HOSTILE_RADIUS (12)
    engine.consumeEvents();
    engine.dispatch({ type: "placeBlock" });
    expect(engine.consumeEvents().some((event) => event.type === "sleepDenied" && event.reason === "hostiles")).toBe(true);
    expect(engine.state.sleepTimer).toBe(0);
  });

  test("dying respawns at the bed when the spawn point still holds one", () => {
    const engine = makeEngine();
    const { state } = engine;
    const bx = 20;
    const by = state.world.highestSolidY(bx, 20) + 1;
    const bz = 20;
    state.blockChanges.set(bx, by, bz, BlockId.Bed);
    state.spawnPoint = { x: bx, y: by, z: bz };
    state.hearts = 1;
    state.player.position.y = -10; // into the void
    run(engine, 2); // die
    expect(state.isDead).toBe(true);
    engine.dispatch({ type: "respawn" });
    run(engine, 0.1);
    expect(state.isDead).toBe(false);
    expect(state.player.position.x).toBeCloseTo(bx + 0.5, 3);
    expect(state.player.position.z).toBeCloseTo(bz + 0.5, 3);
  });

  test("a destroyed bed falls back to a random respawn", () => {
    const engine = makeEngine();
    const { state } = engine;
    state.spawnPoint = { x: 5, y: 40, z: 5 }; // block here is NOT a bed (never placed)
    const bedSpotY = 40 + 1.05;
    state.hearts = 1;
    state.player.position.y = -10;
    run(engine, 2);
    engine.dispatch({ type: "respawn" });
    run(engine, 0.1);
    expect(state.isDead).toBe(false);
    // Did not teleport onto the missing bed; took the random land point instead.
    expect(state.player.position.y).not.toBeCloseTo(bedSpotY, 2);
  });
});

describe("farming", () => {
  /** Settles the player and aims at a block one cell ahead at eye height; returns its coords. */
  function aimAtBlockAhead(engine: GameEngine, block: BlockId): { x: number; y: number; z: number } {
    run(engine, 1);
    const { state } = engine;
    const ex = Math.floor(state.player.position.x);
    const ez = Math.floor(state.player.position.z);
    state.player.position.x = ex + 0.5;
    state.player.position.z = ez + 0.5;
    state.player.yaw = 0;
    state.player.pitch = 0;
    const ey = Math.floor(state.player.position.y + EYE_HEIGHT);
    state.blockChanges.set(ex, ey, ez, BlockId.Air);
    state.blockChanges.set(ex, ey, ez - 1, block);
    return { x: ex, y: ey, z: ez - 1 };
  }

  function giveSelected(engine: GameEngine, itemId: string, count: number): void {
    const { state } = engine;
    const slot = state.inventory.findIndex((entry) => !entry.id);
    state.inventory = [...state.inventory];
    state.inventory[slot] = createSlot(itemId, count);
    state.selectedSlot = slot;
  }

  /** Mines the block directly under the player (look straight down, hold the mouse). */
  function harvestUnderfoot(engine: GameEngine, block: BlockId): { x: number; y: number; z: number } {
    run(engine, 1);
    const { state } = engine;
    const px = Math.floor(state.player.position.x);
    const pz = Math.floor(state.player.position.z);
    state.player.position.x = px + 0.5;
    state.player.position.z = pz + 0.5;
    state.player.pitch = -Math.PI / 2 + 0.02;
    const py = Math.floor(state.player.position.y) - 1;
    // Bedrock floor below so that once the crop breaks the player lands on an
    // unmineable block — only the crop is harvested, keeping drop counts exact.
    state.blockChanges.set(px, py - 1, pz, BlockId.Bedrock);
    state.blockChanges.set(px, py, pz, block);
    return { x: px, y: py, z: pz };
  }

  test("a hoe tills grass into farmland and wears down", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    const target = aimAtBlockAhead(engine, BlockId.Grass);
    giveSelected(engine, "wood_hoe", 1);
    const durBefore = engine.state.inventory[engine.state.selectedSlot].durability!;
    engine.consumeEvents();
    engine.dispatch({ type: "placeBlock" });
    expect(engine.state.world.get(target.x, target.y, target.z)).toBe(BlockId.Farmland);
    expect(engine.consumeEvents().some((event) => event.type === "tilledSoil")).toBe(true);
    expect(engine.state.inventory[engine.state.selectedSlot].durability).toBe(durBefore - 1);
  });

  test("seeds plant wheat on farmland and consume one seed", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    const farmland = aimAtBlockAhead(engine, BlockId.Farmland);
    engine.state.blockChanges.set(farmland.x, farmland.y + 1, farmland.z, BlockId.Air); // clear space above
    giveSelected(engine, "seeds", 3);
    engine.consumeEvents();
    engine.dispatch({ type: "placeBlock" });
    expect(engine.state.world.get(farmland.x, farmland.y + 1, farmland.z)).toBe(BlockId.WheatStage0);
    expect(engine.consumeEvents().some((event) => event.type === "plantedSeed")).toBe(true);
    expect(countsById(engine.state.inventory).get("seeds")).toBe(2);
  });

  test("harvesting mature wheat yields wheat and at least one seed", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    const crop = harvestUnderfoot(engine, BlockId.WheatStage3);
    const wheatBefore = countsById(engine.state.inventory).get("wheat") ?? 0;
    run(engine, 2, input({ leftMouseHeld: true, pointerLocked: true }));
    expect(engine.state.world.get(crop.x, crop.y, crop.z)).toBe(BlockId.Air);
    expect(countsById(engine.state.inventory).get("wheat") ?? 0).toBe(wheatBefore + 1);
    expect(countsById(engine.state.inventory).get("seeds") ?? 0).toBeGreaterThanOrEqual(1);
  });

  test("harvesting an immature crop returns only a seed", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    const crop = harvestUnderfoot(engine, BlockId.WheatStage1);
    const wheatBefore = countsById(engine.state.inventory).get("wheat") ?? 0;
    const seedsBefore = countsById(engine.state.inventory).get("seeds") ?? 0;
    run(engine, 2, input({ leftMouseHeld: true, pointerLocked: true }));
    expect(engine.state.world.get(crop.x, crop.y, crop.z)).toBe(BlockId.Air);
    expect(countsById(engine.state.inventory).get("wheat") ?? 0).toBe(wheatBefore);
    expect(countsById(engine.state.inventory).get("seeds") ?? 0).toBe(seedsBefore + 1);
  });

  test("bread crafts from wheat and restores its hunger value", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    giveSelected(engine, "wheat", 3);
    engine.dispatch({ type: "craft", recipeId: "bread" });
    expect(countsById(engine.state.inventory).get("bread")).toBe(1);

    const breadSlot = engine.state.inventory.findIndex((entry) => entry.id === "bread");
    engine.state.selectedSlot = breadSlot;
    engine.state.hunger = 5;
    engine.dispatch({ type: "eatFood" });
    expect(engine.state.hunger).toBe(11); // 5 + 6
  });
});

describe("furnace and cooking", () => {
  function giveItem(engine: GameEngine, itemId: string, count: number): void {
    const { state } = engine;
    const slot = state.inventory.findIndex((entry) => !entry.id);
    state.inventory = [...state.inventory];
    state.inventory[slot] = createSlot(itemId, count);
  }

  test("right-clicking a furnace opens the inventory in furnace mode", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    const { state } = engine;
    const ex = Math.floor(state.player.position.x);
    const ez = Math.floor(state.player.position.z);
    state.player.position.x = ex + 0.5;
    state.player.position.z = ez + 0.5;
    state.player.yaw = 0;
    state.player.pitch = 0;
    const ey = Math.floor(state.player.position.y + EYE_HEIGHT);
    state.blockChanges.set(ex, ey, ez, BlockId.Air);
    state.blockChanges.set(ex, ey, ez - 1, BlockId.Furnace);
    engine.consumeEvents();
    engine.dispatch({ type: "placeBlock" });
    expect(engine.consumeEvents().some((event) => event.type === "openedStation" && event.station === "furnace")).toBe(true);
    expect(state.inventoryOpen).toBe(true);
    expect(state.craftingStation).toBe("furnace");
  });

  test("a furnace recipe only crafts with the furnace open, and emits smelted", () => {
    const engine = makeEngine();
    const { state } = engine;
    giveItem(engine, "raw_chicken", 1); // planks are in the starter loadout

    engine.dispatch({ type: "craft", recipeId: "cook_chicken" }); // no station open
    expect(countsById(state.inventory).get("cooked_chicken")).toBeUndefined();
    expect(countsById(state.inventory).get("raw_chicken")).toBe(1); // ingredients untouched

    state.craftingStation = "furnace";
    engine.consumeEvents();
    engine.dispatch({ type: "craft", recipeId: "cook_chicken" });
    expect(countsById(state.inventory).get("cooked_chicken")).toBe(1);
    expect(countsById(state.inventory).get("raw_chicken")).toBeUndefined();
    expect(engine.consumeEvents().some((event) => event.type === "smelted")).toBe(true);
  });

  test("closing the inventory clears the open station", () => {
    const engine = makeEngine();
    engine.state.inventoryOpen = true;
    engine.state.craftingStation = "furnace";
    engine.dispatch({ type: "toggleInventory" });
    expect(engine.state.inventoryOpen).toBe(false);
    expect(engine.state.craftingStation).toBeNull();
  });
});

describe("animal breeding", () => {
  function pushSheepAhead(engine: GameEngine, ageTimer = 0): number {
    const { state } = engine;
    const p = state.player.position;
    const id = state.nextMobId++;
    state.mobs.push({
      id,
      kind: "sheep",
      hostile: false,
      hp: 10,
      position: new THREE.Vector3(p.x, p.y + EYE_HEIGHT, p.z - 2),
      direction: new THREE.Vector3(0, 0, 1),
      yaw: 0,
      turnTimer: 9,
      speed: 0,
      moveSpeed: 0,
      detectRange: 0,
      attackDamage: 0,
      attackCooldown: 0,
      attackTimer: 0,
      halfHeight: 0.9,
      bobSeed: 0,
      fedTimer: 0,
      ageTimer
    });
    return id;
  }

  function giveSelected(engine: GameEngine, itemId: string, count: number): void {
    const { state } = engine;
    const slot = state.inventory.findIndex((entry) => !entry.id);
    state.inventory = [...state.inventory];
    state.inventory[slot] = createSlot(itemId, count);
    state.selectedSlot = slot;
  }

  test("right-clicking an animal with its food feeds it instead of placing", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    engine.state.player.yaw = 0;
    engine.state.player.pitch = 0;
    const id = pushSheepAhead(engine);
    giveSelected(engine, "wheat", 2);
    engine.consumeEvents();
    engine.dispatch({ type: "placeBlock" });
    expect(engine.consumeEvents().some((event) => event.type === "mobFed" && event.kind === "sheep")).toBe(true);
    expect(countsById(engine.state.inventory).get("wheat")).toBe(1);
    const sheep = engine.state.mobs.find((mob) => mob.id === id)!;
    expect(sheep.fedTimer).toBeGreaterThan(0);
  });

  test("killing a baby drops nothing", () => {
    const engine = new GameEngine({ seed: 1337, rng: () => 0, worldSize: { x: 64, y: 150, z: 64 } });
    calmDaytime(engine);
    run(engine, 1);
    engine.state.player.yaw = 0;
    engine.state.player.pitch = 0;
    const id = pushSheepAhead(engine, 50); // a baby (ageTimer > 0)
    const baby = engine.state.mobs.find((mob) => mob.id === id)!;
    baby.hp = 1; // one fist hit kills it
    const before = countsById(engine.state.inventory);
    engine.consumeEvents();
    engine.dispatch({ type: "attack" });
    const events = engine.consumeEvents();
    expect(engine.state.mobs.some((mob) => mob.id === id)).toBe(false); // died
    expect(events.some((event) => event.type === "pickedUp")).toBe(false); // no loot toast for a baby
    const after = countsById(engine.state.inventory);
    expect(after.get("wool") ?? 0).toBe(before.get("wool") ?? 0);
    expect(after.get("raw_mutton") ?? 0).toBe(before.get("raw_mutton") ?? 0);
  });
});

describe("endgame boss", () => {
  function giveSummoner(engine: GameEngine, count: number): void {
    engine.state.inventory = [...engine.state.inventory];
    engine.state.inventory[0] = createSlot("boss_summoner", count);
    engine.state.selectedSlot = 0;
  }

  test("a Cursed Totem summons one boss, consuming the totem", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    giveSummoner(engine, 2);
    engine.consumeEvents();

    engine.dispatch({ type: "placeBlock" });
    expect(engine.state.mobs.filter((mob) => mob.kind === "boss")).toHaveLength(1);
    expect(countsById(engine.state.inventory).get("boss_summoner")).toBe(1);
    expect(engine.consumeEvents().some((event) => event.type === "bossSummoned")).toBe(true);
    expect(engine.getSnapshot().boss).not.toBeNull();
    expect(engine.getSnapshot().boss!.hpPercent).toBeCloseTo(1, 2);
  });

  test("a second summon is refused while a boss already walks", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    giveSummoner(engine, 2);
    engine.dispatch({ type: "placeBlock" }); // first boss
    engine.consumeEvents();

    engine.dispatch({ type: "placeBlock" }); // refused
    expect(engine.state.mobs.filter((mob) => mob.kind === "boss")).toHaveLength(1);
    expect(countsById(engine.state.inventory).get("boss_summoner")).toBe(1); // totem kept
    expect(engine.consumeEvents().some((event) => event.type === "summonFailed")).toBe(true);
  });

  test("the boss health snapshot tracks damage", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    giveSummoner(engine, 1);
    engine.dispatch({ type: "placeBlock" });
    const boss = engine.state.mobs.find((mob) => mob.kind === "boss")!;

    boss.hp = BOSS_HP / 2;
    run(engine, 0.05); // a step refreshes the snapshot
    expect(engine.getSnapshot().boss!.hpPercent).toBeCloseTo(0.5, 2);
  });

  test("defeating the boss drops the Dragon Heart and triggers victory", () => {
    const engine = makeEngine();
    calmDaytime(engine);
    run(engine, 1);
    giveSummoner(engine, 1);
    engine.dispatch({ type: "placeBlock" });
    const boss = engine.state.mobs.find((mob) => mob.kind === "boss")!;
    engine.consumeEvents();

    boss.hp = 0; // next tick removes it
    run(engine, 0.1);

    expect(engine.state.mobs.some((mob) => mob.kind === "boss")).toBe(false);
    expect(countsById(engine.state.inventory).get("dragon_heart")).toBe(1);
    expect(engine.consumeEvents().some((event) => event.type === "bossDefeated")).toBe(true);
    const snap = engine.getSnapshot();
    expect(snap.victory).toBe(true);
    expect(snap.boss).toBeNull();

    // The victory screen owns its lock-loss, so a lock-loss pause is ignored
    // until it's dismissed (otherwise the pause menu would stack over it).
    engine.dispatch({ type: "pause" });
    expect(engine.getSnapshot().paused).toBe(false);

    engine.dispatch({ type: "dismissVictory" });
    expect(engine.getSnapshot().victory).toBe(false);
    engine.dispatch({ type: "pause" });
    expect(engine.getSnapshot().paused).toBe(true); // pausing works again once dismissed
  });

  test("the boss does not burn in daylight", () => {
    const engine = makeEngine();
    engine.state.mobs = engine.state.mobs.filter((mob) => !mob.hostile);
    engine.state.dayClock = 60; // bright midday
    run(engine, 0.5);
    giveSummoner(engine, 1);
    engine.dispatch({ type: "placeBlock" });
    const boss = engine.state.mobs.find((mob) => mob.kind === "boss")!;
    const hpBefore = boss.hp;
    run(engine, 2);
    expect(engine.state.daylight).toBeGreaterThan(0.72);
    expect(boss.hp).toBe(hpBefore); // immune to the daylight burn
  });
});
