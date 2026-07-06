import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BlockId, stairBlock, VoxelWorld, type StairFacing } from "@/lib/world";
import { createBlockChangeTracker } from "@/lib/game/engine/blockChanges";
import { createRedstoneState } from "@/lib/game/engine/systems/redstone";
import type { GameEvent, GameState, PlayerState } from "@/lib/game/engine/state";
import { canMineBlock, placeSelectedBlock } from "@/lib/game/engine/systems/mining";
import { createSlot } from "@/lib/game/items";

describe("canMineBlock tool tiers", () => {
  test("coal ore needs a wood pickaxe (tier 1), like stone", () => {
    expect(canMineBlock(BlockId.CoalOre, 0)).toBe(false); // bare hand can't
    expect(canMineBlock(BlockId.CoalOre, 1)).toBe(true); // wood pickaxe can
    expect(canMineBlock(BlockId.Stone, 0)).toBe(false);
    expect(canMineBlock(BlockId.Stone, 1)).toBe(true);
  });

  test("rarer ores keep their higher tier gates", () => {
    expect(canMineBlock(BlockId.SliverOre, 1)).toBe(false);
    expect(canMineBlock(BlockId.SliverOre, 2)).toBe(true);
    expect(canMineBlock(BlockId.DiamondOre, 3)).toBe(false);
    expect(canMineBlock(BlockId.DiamondOre, 4)).toBe(true);
  });

  test("soft blocks break with bare hands", () => {
    expect(canMineBlock(BlockId.Dirt, 0)).toBe(true);
    expect(canMineBlock(BlockId.Grass, 0)).toBe(true);
    expect(canMineBlock(BlockId.Wood, 0)).toBe(true);
  });

  test("obsidian yields only to the diamond pickaxe (tier 7)", () => {
    expect(canMineBlock(BlockId.Obsidian, 6)).toBe(false); // gold pickaxe can't
    expect(canMineBlock(BlockId.Obsidian, 7)).toBe(true);
  });
});

describe("placeSelectedBlock — partial blocks", () => {
  const FLOOR_Y = 10;
  const TARGET = { x: 7, y: FLOOR_Y + 1, z: 5 } as const;

  /**
   * A stone floor with the player floating above the target column, aiming
   * straight down — the raycast hits the floor at (7, 10, 5) and `previous`
   * (the placement cell) is (7, 11, 5). The player's body clears that cell,
   * so the self-entombment revert never triggers.
   */
  function makeFixture(itemId: string): { state: GameState; player: PlayerState; events: GameEvent[] } {
    const world = new VoxelWorld(24, 24, 24, 1);
    for (let x = 0; x < world.sizeX; x += 1) {
      for (let z = 0; z < world.sizeZ; z += 1) world.set(x, FLOOR_Y, z, BlockId.Stone);
    }
    const player = {
      id: "local",
      position: new THREE.Vector3(TARGET.x + 0.5, TARGET.y + 2, TARGET.z + 0.5),
      velocity: new THREE.Vector3(),
      yaw: 0,
      pitch: -Math.PI / 2, // straight down
      onGround: false,
      gameMode: "survival",
      selectedSlot: 0,
      inventory: [createSlot(itemId, 2)]
    } as unknown as PlayerState;
    const events: GameEvent[] = [];
    const state = {
      world,
      blockChanges: createBlockChangeTracker(world),
      containers: new Map(),
      redstone: createRedstoneState(),
      players: new Map([["local", player]]),
      player,
      worldMeshDirty: false
    } as unknown as GameState;
    return { state, player, events };
  }

  test("a placed stair faces the way the player looks, for all four yaws", () => {
    const cases: Array<[number, StairFacing]> = [
      [0, "north"],
      [-Math.PI / 2, "east"],
      [Math.PI, "south"],
      [Math.PI / 2, "west"]
    ];
    for (const [yaw, facing] of cases) {
      const { state, player, events } = makeFixture("stone_stairs");
      player.yaw = yaw;
      placeSelectedBlock(state, player, (e) => events.push(e));
      expect(state.world.get(TARGET.x, TARGET.y, TARGET.z)).toBe(stairBlock("stone", facing));
      expect(player.inventory[0]?.count).toBe(1); // one consumed
    }
  });

  test("a placed slab is the plain slab id (no orientation)", () => {
    const { state, player, events } = makeFixture("plank_slab");
    placeSelectedBlock(state, player, (e) => events.push(e));
    expect(state.world.get(TARGET.x, TARGET.y, TARGET.z)).toBe(BlockId.PlankSlab);
  });

  test("a rail refuses a slab as support and refunds the item", () => {
    const { state, player } = makeFixture("rail");
    state.world.set(TARGET.x, FLOOR_Y, TARGET.z, BlockId.StoneSlab); // half-height support
    placeSelectedBlock(state, player, () => {});
    expect(state.world.get(TARGET.x, TARGET.y, TARGET.z)).toBe(BlockId.Air);
    expect(player.inventory[0]?.count).toBe(2); // refunded
  });

  test("a door refuses a stair as support", () => {
    const { state, player } = makeFixture("door");
    state.world.set(TARGET.x, FLOOR_Y, TARGET.z, BlockId.CobbleStairsNorth);
    placeSelectedBlock(state, player, () => {});
    expect(state.world.get(TARGET.x, TARGET.y, TARGET.z)).toBe(BlockId.Air);
    expect(player.inventory[0]?.count).toBe(2);
  });
});
