import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { EYE_HEIGHT } from "@/lib/game/config";
import { BlockId, VoxelWorld } from "@/lib/world";
import { createBlockChangeTracker } from "@/lib/game/engine/blockChanges";
import type { GameEvent, GameState, PlayerState } from "@/lib/game/engine/state";
import { clearAttachedPortal, findPortalFrame, fillPortalFrame, tryIgnitePortal } from "@/lib/game/engine/systems/portal";
import { createSlot } from "@/lib/game/items";
import type { InventorySlot } from "@/lib/game/types";

const FLOOR_Y = 10;

/**
 * Builds an obsidian frame standing on a stone floor with a `w`×`h` interior,
 * running along `axis`, its interior base corner at (bx, FLOOR_Y+1, bz).
 */
function buildFrame(world: VoxelWorld, axis: "x" | "z", bx: number, bz: number, w: number, h: number): void {
  const dx = axis === "x" ? 1 : 0;
  const dz = axis === "z" ? 1 : 0;
  const baseY = FLOOR_Y + 1;
  for (let i = -1; i <= w; i += 1) {
    world.set(bx + dx * i, baseY - 1, bz + dz * i, BlockId.Obsidian); // bottom incl corners
    world.set(bx + dx * i, baseY + h, bz + dz * i, BlockId.Obsidian); // top incl corners
  }
  for (let j = 0; j < h; j += 1) {
    world.set(bx - dx, baseY + j, bz - dz, BlockId.Obsidian); // left
    world.set(bx + dx * w, baseY + j, bz + dz * w, BlockId.Obsidian); // right
  }
}

function makeWorld(): VoxelWorld {
  const world = new VoxelWorld(24, 24, 24, 1);
  for (let x = 0; x < world.sizeX; x += 1) {
    for (let z = 0; z < world.sizeZ; z += 1) world.set(x, FLOOR_Y, z, BlockId.Stone);
  }
  return world;
}

function makeState(world: VoxelWorld, slots: InventorySlot[], playerPos: THREE.Vector3): { state: GameState; player: PlayerState; events: GameEvent[] } {
  const player = {
    id: "local",
    position: playerPos,
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    onGround: true,
    gameMode: "survival",
    selectedSlot: 0,
    inventory: slots
  } as unknown as PlayerState;
  const events: GameEvent[] = [];
  const state = {
    world,
    dimension: "overworld",
    blockChanges: createBlockChangeTracker(world),
    players: new Map([["local", player]]),
    worldMeshDirty: false
  } as unknown as GameState;
  return { state, player, events };
}

describe("findPortalFrame", () => {
  test("validates a minimal 2×3 frame from any interior cell, on both axes", () => {
    for (const axis of ["x", "z"] as const) {
      const world = makeWorld();
      buildFrame(world, axis, 8, 8, 2, 3);
      for (let i = 0; i < 2; i += 1) {
        for (let j = 0; j < 3; j += 1) {
          const x = 8 + (axis === "x" ? i : 0);
          const z = 8 + (axis === "z" ? i : 0);
          const frame = findPortalFrame(world, x, FLOOR_Y + 1 + j, z);
          expect(frame).not.toBeNull();
          expect(frame!.axis).toBe(axis);
          expect(frame!.base).toEqual({ x: 8, y: FLOOR_Y + 1, z: 8 });
          expect(frame!.w).toBe(2);
          expect(frame!.h).toBe(3);
        }
      }
    }
  });

  test("validates the maximum 4×4 interior", () => {
    const world = makeWorld();
    buildFrame(world, "x", 8, 8, 4, 4);
    const frame = findPortalFrame(world, 9, FLOOR_Y + 2, 8);
    expect(frame).not.toBeNull();
    expect(frame!.w).toBe(4);
    expect(frame!.h).toBe(4);
  });

  test("a missing corner invalidates the frame (stricter than Minecraft, on purpose)", () => {
    const world = makeWorld();
    buildFrame(world, "x", 8, 8, 2, 3);
    world.set(7, FLOOR_Y, 8, BlockId.Stone); // bottom-left corner gone
    expect(findPortalFrame(world, 8, FLOOR_Y + 1, 8)).toBeNull();
  });

  test("a missing side block invalidates the frame", () => {
    const world = makeWorld();
    buildFrame(world, "x", 8, 8, 2, 3);
    world.set(10, FLOOR_Y + 2, 8, BlockId.Air); // a right-side block gone (border at bx + w = 10)
    expect(findPortalFrame(world, 8, FLOOR_Y + 1, 8)).toBeNull();
  });

  test("an oversize interior is rejected", () => {
    const world = makeWorld();
    buildFrame(world, "x", 8, 8, 5, 3); // 5 wide — past the 4 cap
    expect(findPortalFrame(world, 9, FLOOR_Y + 1, 8)).toBeNull();
    const tall = makeWorld();
    buildFrame(tall, "x", 8, 8, 2, 5); // 5 tall
    expect(findPortalFrame(tall, 8, FLOOR_Y + 1, 8)).toBeNull();
  });

  test("an undersize interior is rejected", () => {
    const world = makeWorld();
    buildFrame(world, "x", 8, 8, 1, 3); // 1 wide
    expect(findPortalFrame(world, 8, FLOOR_Y + 1, 8)).toBeNull();
    const short = makeWorld();
    buildFrame(short, "x", 8, 8, 2, 2); // 2 tall
    expect(findPortalFrame(short, 8, FLOOR_Y + 1, 8)).toBeNull();
  });

  test("a lit portal (interior already filled) still validates — the travel-time backstop", () => {
    const world = makeWorld();
    buildFrame(world, "x", 8, 8, 2, 3);
    for (let i = 0; i < 2; i += 1) for (let j = 0; j < 3; j += 1) world.set(8 + i, FLOOR_Y + 1 + j, 8, BlockId.NetherPortal);
    expect(findPortalFrame(world, 8, FLOOR_Y + 1, 8)).not.toBeNull();
  });
});

describe("tryIgnitePortal", () => {
  /**
   * The player stands INSIDE the (unlit) frame — the Minecraft gesture is
   * striking the bottom bar's inner face, so the raycast's `previous` cell is
   * the interior base cell. Aiming straight down from inside guarantees it.
   */
  function igniteFixture(): { state: GameState; player: PlayerState; events: GameEvent[] } {
    const world = makeWorld();
    buildFrame(world, "x", 8, 8, 2, 3);
    return makeState(world, [createSlot("flint_and_steel", 1)], new THREE.Vector3(8.5, FLOOR_Y + 1, 8.5));
  }

  test("a valid frame lights: interior filled, striker worn, portalLit emitted", () => {
    const { state, player, events } = igniteFixture();
    // Strike the bottom bar straight down through the interior cell.
    aimAt(player, 8.5, FLOOR_Y + 0.5, 8.5);
    expect(
      tryIgnitePortal(
        state,
        player,
        (e) => events.push(e),
        true,
        () => 0.5
      )
    ).toBe(true);
    expect(events).toContainEqual({ type: "portalLit" });
    expect(state.world.get(8, FLOOR_Y + 1, 8)).toBe(BlockId.NetherPortal);
    expect(state.world.get(9, FLOOR_Y + 3, 8)).toBe(BlockId.NetherPortal);
    expect(player.inventory[0]?.durability).toBe(63); // one strike
    // The lit surface casts light into the chamber.
    expect(state.world.getBlockLight(8, FLOOR_Y + 2, 8)).toBeGreaterThan(0);
  });

  test("portals disabled (an online world) deny with the online reason and light nothing", () => {
    const { state, player, events } = igniteFixture();
    aimAt(player, 8.5, FLOOR_Y + 0.5, 8.5);
    expect(
      tryIgnitePortal(
        state,
        player,
        (e) => events.push(e),
        false,
        () => 0.5
      )
    ).toBe(true);
    expect(events).toContainEqual({ type: "portalDenied", reason: "online" });
    expect(state.world.get(8, FLOOR_Y + 1, 8)).toBe(BlockId.Air);
    expect(player.inventory[0]?.durability).toBe(64); // nothing consumed
  });

  test("an incomplete frame denies with the invalidFrame reason", () => {
    const { state, player, events } = igniteFixture();
    state.world.set(7, FLOOR_Y, 8, BlockId.Stone); // knock out a corner
    aimAt(player, 8.5, FLOOR_Y + 0.5, 8.5);
    expect(
      tryIgnitePortal(
        state,
        player,
        (e) => events.push(e),
        true,
        () => 0.5
      )
    ).toBe(true);
    expect(events).toContainEqual({ type: "portalDenied", reason: "invalidFrame" });
    expect(state.world.get(8, FLOOR_Y + 1, 8)).toBe(BlockId.Air);
  });

  test("aiming at plain stone with flint & steel does nothing (falls through)", () => {
    const { state, player, events } = igniteFixture();
    aimAt(player, 8.5, FLOOR_Y + 0.5, 10.5); // bare floor just outside the frame
    expect(
      tryIgnitePortal(
        state,
        player,
        (e) => events.push(e),
        true,
        () => 0.5
      )
    ).toBe(false);
    expect(events).toHaveLength(0);
  });
});

describe("clearAttachedPortal", () => {
  test("breaking a frame block clears the whole attached surface", () => {
    const world = makeWorld();
    buildFrame(world, "x", 8, 8, 2, 3);
    const { state } = makeState(world, [], new THREE.Vector3(8.5, FLOOR_Y + 1, 12.5));
    fillPortalFrame(state, { axis: "x", base: { x: 8, y: FLOOR_Y + 1, z: 8 }, w: 2, h: 3 });
    expect(state.world.get(9, FLOOR_Y + 2, 8)).toBe(BlockId.NetherPortal);

    // Mining out the bottom-left frame block (what mining.ts calls after Air-ing it).
    state.blockChanges.set(8, FLOOR_Y, 8, BlockId.Air);
    clearAttachedPortal(state, 8, FLOOR_Y, 8);

    for (let i = 0; i < 2; i += 1) {
      for (let j = 0; j < 3; j += 1) expect(state.world.get(8 + i, FLOOR_Y + 1 + j, 8)).toBe(BlockId.Air);
    }
  });

  test("is a cheap no-op when no portal touches the broken block", () => {
    const world = makeWorld();
    const { state } = makeState(world, [], new THREE.Vector3(8.5, FLOOR_Y + 1, 12.5));
    state.worldMeshDirty = false;
    clearAttachedPortal(state, 5, FLOOR_Y, 5);
    expect(state.worldMeshDirty).toBe(false);
  });
});

/** Points the player's eye ray at a world position (matches lookDirection's yaw/pitch convention: x = -cp·sin(yaw), y = sin(pitch), z = -cp·cos(yaw)). */
function aimAt(player: PlayerState, tx: number, ty: number, tz: number): void {
  const eye = new THREE.Vector3(player.position.x, player.position.y + EYE_HEIGHT, player.position.z);
  const dir = new THREE.Vector3(tx, ty, tz).sub(eye).normalize();
  player.pitch = Math.asin(dir.y);
  player.yaw = Math.atan2(-dir.x, -dir.z);
}
