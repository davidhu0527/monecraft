import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BlockId, VoxelWorld } from "@/lib/world";
import { RANDOM_TICK_INTERVAL_SECONDS } from "@/lib/game/config";
import { createBlockChangeTracker } from "@/lib/game/engine/blockChanges";
import { createTimers, type GameState } from "@/lib/game/engine/state";
import { tickRandomBlocks } from "@/lib/game/engine/systems/randomTicks";

/**
 * Builds a minimal GameState with just the fields the random-tick system reads.
 * The world is empty (all air) except for blocks the test places, so the column
 * top is whatever was set. The player sits at (8, _, 8); rng 0.5 maps a sample
 * to that exact column (`px + floor((0.5*2-1)*radius) === px`).
 */
function makeState(): GameState {
  const world = new VoxelWorld(16, 32, 16, 1);
  const blockChanges = createBlockChangeTracker(world);
  return {
    world,
    blockChanges,
    player: { position: new THREE.Vector3(8, 6, 8), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true },
    timers: createTimers(),
    worldMeshDirty: false
  } as unknown as GameState;
}

/** rng: 0.5 for the two coordinate draws (center) and `growth` for the grow roll. */
function scriptedRng(growth: number): () => number {
  let n = 0;
  return () => {
    const v = n % 3 === 2 ? growth : 0.5;
    n += 1;
    return v;
  };
}

describe("random block ticks", () => {
  test("a sampled crop advances toward maturity", () => {
    const state = makeState();
    state.blockChanges.set(8, 5, 8, BlockId.WheatStage0);
    // Every one of the 64 samples lands on (8,8) and passes the growth roll, so
    // the crop climbs 0 -> 1 -> 2 -> 3 and then stops (mature has no handler).
    tickRandomBlocks(state, RANDOM_TICK_INTERVAL_SECONDS, scriptedRng(0));
    expect(state.world.get(8, 5, 8)).toBe(BlockId.WheatStage3);
    expect(state.worldMeshDirty).toBe(true);
  });

  test("does nothing before the tick interval elapses", () => {
    const state = makeState();
    state.blockChanges.set(8, 5, 8, BlockId.WheatStage0);
    tickRandomBlocks(state, RANDOM_TICK_INTERVAL_SECONDS / 2, scriptedRng(0));
    expect(state.world.get(8, 5, 8)).toBe(BlockId.WheatStage0);
  });

  test("leaves non-crop blocks untouched", () => {
    const state = makeState();
    state.blockChanges.set(8, 5, 8, BlockId.Stone);
    tickRandomBlocks(state, RANDOM_TICK_INTERVAL_SECONDS, () => 0.5);
    expect(state.world.get(8, 5, 8)).toBe(BlockId.Stone);
  });

  test("does not advance the crop when the growth roll fails", () => {
    const state = makeState();
    state.blockChanges.set(8, 5, 8, BlockId.WheatStage0);
    // 0.99 is at/above CROP_GROWTH_CHANCE, so every roll fails.
    tickRandomBlocks(state, RANDOM_TICK_INTERVAL_SECONDS, scriptedRng(0.99));
    expect(state.world.get(8, 5, 8)).toBe(BlockId.WheatStage0);
  });

  test("a sapling on soil grows into a tree", () => {
    const state = makeState();
    state.blockChanges.set(8, 4, 8, BlockId.Dirt);
    state.blockChanges.set(8, 5, 8, BlockId.Sapling);
    // First sample lands on (8,8), passes the grow roll (0.0), and draws trunk
    // height (0.0 -> 3 tall); every later sample finds canopy leaves (no handler).
    let i = 0;
    const seq = [0.5, 0.5, 0.0, 0.0];
    const rng = () => (i < seq.length ? seq[i++] : 0.5);
    tickRandomBlocks(state, RANDOM_TICK_INTERVAL_SECONDS, rng);
    expect(state.world.get(8, 5, 8)).toBe(BlockId.Wood); // trunk base replaced the sapling
    expect(state.world.get(8, 6, 8)).toBe(BlockId.Wood);
    expect(state.world.get(8, 9, 8)).toBe(BlockId.Leaves); // canopy above the trunk
    expect(state.world.get(8, 4, 8)).toBe(BlockId.Dirt); // soil it grew from is untouched
    expect(state.worldMeshDirty).toBe(true);
  });

  test("a sapling floating off soil never grows", () => {
    const state = makeState();
    state.blockChanges.set(8, 5, 8, BlockId.Sapling); // nothing solid below it
    // 0.0 passes the grow roll, so only the soil gate keeps it a sapling.
    tickRandomBlocks(state, RANDOM_TICK_INTERVAL_SECONDS, scriptedRng(0));
    expect(state.world.get(8, 5, 8)).toBe(BlockId.Sapling);
  });

  test("a sapling does not grow when the growth roll fails", () => {
    const state = makeState();
    state.blockChanges.set(8, 4, 8, BlockId.Dirt);
    state.blockChanges.set(8, 5, 8, BlockId.Sapling);
    // 0.99 is at/above SAPLING_GROWTH_CHANCE, so every roll fails.
    tickRandomBlocks(state, RANDOM_TICK_INTERVAL_SECONDS, scriptedRng(0.99));
    expect(state.world.get(8, 5, 8)).toBe(BlockId.Sapling);
  });

  test("exposed dirt beside grass re-grasses", () => {
    const state = makeState();
    state.blockChanges.set(8, 5, 8, BlockId.Dirt); // sampled column top
    state.blockChanges.set(9, 5, 8, BlockId.Grass); // neighbour column top is grass
    tickRandomBlocks(state, RANDOM_TICK_INTERVAL_SECONDS, scriptedRng(0));
    expect(state.world.get(8, 5, 8)).toBe(BlockId.Grass);
    expect(state.worldMeshDirty).toBe(true);
  });

  test("exposed dirt with no grass neighbour stays dirt", () => {
    const state = makeState();
    state.blockChanges.set(8, 5, 8, BlockId.Dirt); // alone, surrounded by air columns
    tickRandomBlocks(state, RANDOM_TICK_INTERVAL_SECONDS, scriptedRng(0));
    expect(state.world.get(8, 5, 8)).toBe(BlockId.Dirt);
  });

  test("dirt does not re-grass when the spread roll fails", () => {
    const state = makeState();
    state.blockChanges.set(8, 5, 8, BlockId.Dirt);
    state.blockChanges.set(9, 5, 8, BlockId.Grass);
    // 0.99 is at/above GRASS_SPREAD_CHANCE, so every roll fails.
    tickRandomBlocks(state, RANDOM_TICK_INTERVAL_SECONDS, scriptedRng(0.99));
    expect(state.world.get(8, 5, 8)).toBe(BlockId.Dirt);
  });
});
