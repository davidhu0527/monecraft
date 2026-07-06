import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BlockId, VoxelWorld } from "@/lib/world";
import type { FrameInput, GameState, PlayerState } from "@/lib/game/engine/state";
import { tickPlayerMotion } from "@/lib/game/engine/systems/playerMotion";

const FLOOR_Y = 10;
const FEET_Y = FLOOR_Y + 1;

/** A 24³ world with a stone floor at FLOOR_Y under x/z 0..23. */
function makeWorld(): VoxelWorld {
  const world = new VoxelWorld(24, 24, 24, 1);
  for (let x = 0; x < world.sizeX; x += 1) {
    for (let z = 0; z < world.sizeZ; z += 1) {
      world.set(x, FLOOR_Y, z, BlockId.Stone);
    }
  }
  return world;
}

function makeState(world = makeWorld()): { state: GameState; player: PlayerState } {
  const player = {
    id: "local",
    position: new THREE.Vector3(5.5, FEET_Y, 5.5),
    velocity: new THREE.Vector3(),
    // Forward is (-sin yaw, -cos yaw): this yaw walks +x (east).
    yaw: -Math.PI / 2,
    pitch: 0,
    onGround: true,
    gameMode: "survival",
    isFlying: false,
    hunger: 20,
    effects: new Map(),
    equippedArmor: { boots: null },
    timers: { voidTimer: 0 }
  } as unknown as PlayerState;
  const state = { world, players: new Map([["local", player]]), player } as unknown as GameState;
  return { state, player };
}

function input(overrides: Partial<{ forward: boolean; jump: boolean; crouch: boolean }> = {}): FrameInput {
  return {
    move: { forward: false, back: false, left: false, right: false, jump: false, sprint: false, crouch: false, ...overrides },
    mineHeld: false
  };
}

function walk(state: GameState, player: PlayerState, frames: number, frameInput = input({ forward: true }), dt = 0.05): void {
  for (let i = 0; i < frames; i += 1) tickPlayerMotion(state, player, frameInput, dt, () => {});
}

describe("auto step-up", () => {
  test("walks up onto a slab run without jumping", () => {
    const { state, player } = makeState();
    for (let x = 7; x <= 12; x += 1) state.world.set(x, FEET_Y, 5, BlockId.StoneSlab);
    walk(state, player, 30);
    expect(player.position.x).toBeGreaterThan(8); // well onto the run
    expect(player.position.y).toBeCloseTo(FEET_Y + 0.5, 1); // standing on slab tops
  });

  test("climbs a stair onto the plateau behind it — a full block, no jump", () => {
    const { state, player } = makeState();
    // Facing east: the low half greets the walker, the raised back is beyond,
    // and a full-height plateau continues where the stair tops out.
    state.world.set(7, FEET_Y, 5, BlockId.StoneStairsEast);
    for (let x = 8; x <= 20; x += 1) state.world.set(x, FEET_Y, 5, BlockId.Stone);
    walk(state, player, 40);
    expect(player.position.x).toBeGreaterThan(8.5); // up and over, onto the plateau
    expect(player.position.y).toBeCloseTo(FEET_Y + 1, 1);
  });

  test("a full block still needs the jump", () => {
    const { state, player } = makeState();
    state.world.set(7, FEET_Y, 5, BlockId.Stone);
    walk(state, player, 30);
    expect(player.position.x).toBeLessThan(7); // blocked at the wall
    expect(player.position.y).toBeCloseTo(FEET_Y, 3); // never lifted
  });

  test("never steps while airborne", () => {
    const { state, player } = makeState();
    state.world.set(7, FEET_Y, 5, BlockId.StoneSlab);
    player.position.set(6.55, FEET_Y, 5.5); // one sub-step from the slab's side
    player.onGround = false; // mid-air (e.g. just jumped)
    player.velocity.y = 0.5; // still rising, so the y pass won't re-ground first
    tickPlayerMotion(state, player, input({ forward: true }), 0.02, () => {});
    expect(player.position.y).toBeLessThan(FEET_Y + 0.3); // no lift onto the slab
    expect(player.position.x).toBeLessThan(6.75); // the side blocked the walk
  });

  test("crouch-walking steps up a slab too (the guard runs after, unaffected)", () => {
    const { state, player } = makeState();
    for (let x = 7; x <= 16; x += 1) state.world.set(x, FEET_Y, 5, BlockId.StoneSlab);
    walk(state, player, 60, input({ forward: true, crouch: true }));
    expect(player.position.x).toBeGreaterThan(7.5);
    expect(player.position.y).toBeCloseTo(FEET_Y + 0.5, 1);
  });

  test("steps up consecutive half-rises like a staircase", () => {
    const { state, player } = makeState();
    // A rising run climbed in three half-steps, never a jump: slab (top +0.5),
    // full block (top +1.0), then a slab-on-stone shelf (top +1.5) continuing east.
    state.world.set(7, FEET_Y, 5, BlockId.StoneSlab);
    state.world.set(8, FEET_Y, 5, BlockId.Stone);
    for (let x = 9; x <= 20; x += 1) {
      state.world.set(x, FEET_Y, 5, BlockId.Stone);
      state.world.set(x, FEET_Y + 1, 5, BlockId.StoneSlab);
    }
    walk(state, player, 40);
    expect(player.position.x).toBeGreaterThan(9.5);
    expect(player.position.y).toBeCloseTo(FEET_Y + 1.5, 1);
  });
});
