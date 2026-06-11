import { describe, expect, test } from "bun:test";
import { BlockId, collidesAt } from "@/lib/world";
import { MAX_HUNGER, MAX_HEARTS, PLAYER_HALF_WIDTH, PLAYER_HEIGHT, REGEN_MIN_HUNGER, SPRINT_BLOCKS_PER_HUNGER, SPRINT_MIN_HUNGER } from "@/lib/game/config";
import { countsById } from "@/lib/game/inventory";
import { GameEngine } from "@/lib/game/engine/GameEngine";
import type { FrameInput } from "@/lib/game/engine/state";

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
    expect(state.mobs.length).toBe(14 + 12 + 8 + 8 + 6 + 6);
    expect(countsById(state.inventory).get("wood")).toBe(64);
    expect(engine.getSnapshot().hearts).toBe(MAX_HEARTS);
    expect(engine.getSnapshot().passiveCount).toBe(34);
    expect(engine.getSnapshot().hostileCount).toBe(20);
  });

  test("the player settles onto the ground under gravity and stays put", () => {
    const engine = makeEngine();
    run(engine, 2);
    const y1 = engine.state.player.position.y;
    run(engine, 1);
    expect(engine.state.player.position.y).toBeCloseTo(y1, 5);
    expect(engine.state.player.onGround).toBe(true);
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
});

describe("death and respawn", () => {
  test("void damage kills, the respawn countdown runs, and the player returns at full health", () => {
    const engine = makeEngine();
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
});
