import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BlockId, VoxelWorld } from "@/lib/world";
import { EYE_HEIGHT, PET_FIGHT_RANGE, PET_TAMED_HP } from "@/lib/game/config";
import { createEmptySlot, createSlot } from "@/lib/game/items";
import { countsById } from "@/lib/game/inventory";
import { createBlockChangeTracker } from "@/lib/game/engine/blockChanges";
import type { GameEvent, GameState, MobState, PlayerState } from "@/lib/game/engine/state";
import { tryTameAimedMob, tryToggleSitPet, tryUseHeldItem } from "@/lib/game/engine/systems/interact";
import type { InventorySlot, MobKind } from "@/lib/game/types";

function inventory(items: Array<[string, number]>): InventorySlot[] {
  const slots = Array.from({ length: 9 }, () => createEmptySlot());
  items.forEach(([id, count], i) => (slots[i] = createSlot(id, count)));
  return slots;
}

function makeState(slots: InventorySlot[], mob: MobState): GameState & PlayerState {
  const state = {
    id: "local",
    position: new THREE.Vector3(0, 64, 0),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    onGround: true,
    inventory: slots,
    selectedSlot: 0,
    mobs: [mob]
  } as unknown as GameState & PlayerState;
  // The flat fixture IS its own player (the old single-player shape).
  (state as { player: unknown }).player = state;
  return state;
}

/** A mob two blocks ahead (down -Z) at eye height — directly in the aim cone. */
function mobInFront(kind: MobKind, overrides: Partial<MobState> = {}): MobState {
  return {
    kind,
    hp: 8,
    faction: "wild",
    detectRange: 0,
    position: new THREE.Vector3(0, 64 + EYE_HEIGHT, -2),
    direction: new THREE.Vector3(),
    ...overrides
  } as unknown as MobState;
}

describe("tryTameAimedMob", () => {
  test("a successful roll tames a wild wolf: owner/faction/hp/range set, bone consumed, event fired", () => {
    const wolf = mobInFront("wolf");
    const state = makeState(inventory([["bone", 2]]), wolf);
    const events: GameEvent[] = [];

    const consumed = tryTameAimedMob(
      state,
      state,
      (e) => events.push(e),
      () => 0
    ); // 0 < TAME_CHANCE → success

    expect(consumed).toBe(true);
    expect(wolf.owner).toBe("local");
    expect(wolf.faction).toBe("ally");
    expect(wolf.hp).toBe(PET_TAMED_HP);
    expect(wolf.detectRange).toBe(PET_FIGHT_RANGE);
    expect(countsById(state.inventory).get("bone") ?? 0).toBe(1); // one bone eaten
    expect(events.some((e) => e.type === "mobTamed" && e.kind === "wolf")).toBe(true);
  });

  test("a failed roll still eats the treat but leaves the mob wild (consumes the click)", () => {
    const wolf = mobInFront("wolf");
    const state = makeState(inventory([["bone", 1]]), wolf);
    const events: GameEvent[] = [];

    const consumed = tryTameAimedMob(
      state,
      state,
      (e) => events.push(e),
      () => 0.9
    ); // 0.9 ≥ TAME_CHANCE → fail

    expect(consumed).toBe(true);
    expect(wolf.owner).toBeUndefined();
    expect(countsById(state.inventory).get("bone") ?? 0).toBe(0); // still eaten
    expect(events.some((e) => e.type === "mobTamed")).toBe(false);
  });

  test("declines the wrong treat and an already-owned pet (no consumption)", () => {
    const wolfWrongTreat = mobInFront("wolf");
    const wrong = makeState(inventory([["wheat", 1]]), wolfWrongTreat);
    expect(
      tryTameAimedMob(
        wrong,
        wrong,
        () => {},
        () => 0
      )
    ).toBe(false);
    expect(countsById(wrong.inventory).get("wheat") ?? 0).toBe(1);

    const ownedWolf = mobInFront("wolf", { owner: "player", faction: "ally" });
    const owned = makeState(inventory([["bone", 1]]), ownedWolf);
    expect(
      tryTameAimedMob(
        owned,
        owned,
        () => {},
        () => 0
      )
    ).toBe(false);
    expect(countsById(owned.inventory).get("bone") ?? 0).toBe(1);
  });
});

describe("tryToggleSitPet", () => {
  test("toggles sit on your own pet and fires the event", () => {
    const pet = mobInFront("wolf", { owner: "player", faction: "ally" });
    const state = makeState(inventory([["diamond_sword", 1]]), pet);
    const events: GameEvent[] = [];

    expect(tryToggleSitPet(state, state, (e) => events.push(e))).toBe(true);
    expect(pet.sitting).toBe(true);
    expect(events.some((e) => e.type === "petSitToggled" && e.sitting === true)).toBe(true);

    expect(tryToggleSitPet(state, state, () => {})).toBe(true);
    expect(pet.sitting).toBe(false); // toggles back
  });

  test("declines a mob you don't own", () => {
    const wild = mobInFront("wolf");
    const state = makeState(inventory([["diamond_sword", 1]]), wild);
    expect(tryToggleSitPet(state, state, () => {})).toBe(false);
    expect(wild.sitting).toBeUndefined();
  });

  test("declines while holding the pet's breeding treat (so a breed attempt doesn't flip sitting)", () => {
    const pet = mobInFront("wolf", { owner: "player", faction: "ally" });
    const state = makeState(inventory([["bone", 1]]), pet); // bone is the wolf's breed/tame treat
    expect(tryToggleSitPet(state, state, () => {})).toBe(false);
    expect(pet.sitting).toBeUndefined();
  });
});

describe("tryUseHeldItem — buckets", () => {
  const FLOOR_Y = 10;
  const CELL = { x: 7, y: FLOOR_Y + 1, z: 5 } as const;

  /**
   * A stone floor with the player floating above the target column, aiming
   * straight down. The fluid under test sits on the floor at CELL; the player
   * hovers high enough that a poured lava block can't entomb them.
   */
  function makeFluidFixture(slots: InventorySlot[], fluid: BlockId | null): { state: GameState; player: PlayerState; events: GameEvent[] } {
    const world = new VoxelWorld(24, 24, 24, 1);
    for (let x = 0; x < world.sizeX; x += 1) {
      for (let z = 0; z < world.sizeZ; z += 1) world.set(x, FLOOR_Y, z, BlockId.Stone);
    }
    if (fluid !== null) world.set(CELL.x, CELL.y, CELL.z, fluid);
    const player = {
      id: "local",
      position: new THREE.Vector3(CELL.x + 0.5, CELL.y + 3, CELL.z + 0.5),
      velocity: new THREE.Vector3(),
      yaw: 0,
      pitch: -Math.PI / 2, // straight down
      onGround: false,
      gameMode: "survival",
      selectedSlot: 0,
      inventory: slots
    } as unknown as PlayerState;
    const events: GameEvent[] = [];
    const state = {
      world,
      blockChanges: createBlockChangeTracker(world),
      players: new Map([["local", player]]),
      worldMeshDirty: false
    } as unknown as GameState;
    return { state, player, events };
  }

  const emitTo =
    (events: GameEvent[]) =>
    (e: GameEvent): void => {
      events.push(e);
    };

  test("an empty bucket scoops water: cell empties, the filled bucket lands in hand", () => {
    const { state, player, events } = makeFluidFixture(inventory([["bucket", 1]]), BlockId.Water);
    expect(tryUseHeldItem(state, player, emitTo(events), () => 0.5)).toBe(true);
    expect(state.world.get(CELL.x, CELL.y, CELL.z)).toBe(BlockId.Air);
    expect(player.inventory[player.selectedSlot]?.id).toBe("water_bucket");
    expect(events).toContainEqual({ type: "bucketFilled", fluid: "water" });
    expect(state.worldMeshDirty).toBe(true);
  });

  test("an empty bucket scoops lava (a solid block) via the normal raycast", () => {
    const { state, player, events } = makeFluidFixture(inventory([["bucket", 1]]), BlockId.Lava);
    expect(tryUseHeldItem(state, player, emitTo(events), () => 0.5)).toBe(true);
    expect(state.world.get(CELL.x, CELL.y, CELL.z)).toBe(BlockId.Air);
    expect(player.inventory[player.selectedSlot]?.id).toBe("lava_bucket");
    expect(events).toContainEqual({ type: "bucketFilled", fluid: "lava" });
  });

  test("a bucket aimed at plain terrain does nothing", () => {
    const { state, player, events } = makeFluidFixture(inventory([["bucket", 1]]), null);
    expect(tryUseHeldItem(state, player, emitTo(events), () => 0.5)).toBe(false);
    expect(player.inventory[player.selectedSlot]?.id).toBe("bucket");
    expect(events).toHaveLength(0);
  });

  test("a water bucket pours onto the aimed face: water placed, empty bucket returns to hand", () => {
    const { state, player, events } = makeFluidFixture(inventory([["water_bucket", 1]]), null);
    expect(tryUseHeldItem(state, player, emitTo(events), () => 0.5)).toBe(true);
    expect(state.world.get(CELL.x, CELL.y, CELL.z)).toBe(BlockId.Water);
    expect(player.inventory[player.selectedSlot]?.id).toBe("bucket");
    expect(events).toContainEqual({ type: "bucketEmptied", fluid: "water" });
  });

  test("a lava bucket pours lava, and the placed cell casts block light", () => {
    const { state, player, events } = makeFluidFixture(inventory([["lava_bucket", 1]]), null);
    expect(tryUseHeldItem(state, player, emitTo(events), () => 0.5)).toBe(true);
    expect(state.world.get(CELL.x, CELL.y, CELL.z)).toBe(BlockId.Lava);
    // blockChanges.set routes through the lighting applyEdit, so lava's max
    // emission shows up in the cell above without any full re-bake.
    expect(state.world.getBlockLight(CELL.x, CELL.y + 1, CELL.z)).toBeGreaterThan(0);
    expect(player.inventory[player.selectedSlot]?.id).toBe("bucket");
    expect(events).toContainEqual({ type: "bucketEmptied", fluid: "lava" });
  });

  test("filling refuses when the filled bucket can't fit anywhere", () => {
    const slots = inventory([
      ["bucket", 2],
      ["stone", 64],
      ["dirt", 64],
      ["grass", 64],
      ["sand", 64],
      ["wood", 64],
      ["planks", 64],
      ["cobble", 64],
      ["brick", 64]
    ]);
    const { state, player, events } = makeFluidFixture(slots, BlockId.Water);
    expect(tryUseHeldItem(state, player, emitTo(events), () => 0.5)).toBe(false);
    expect(state.world.get(CELL.x, CELL.y, CELL.z)).toBe(BlockId.Water); // not scooped
    expect(player.inventory[player.selectedSlot]?.count).toBe(2); // both buckets kept
    expect(events).toHaveLength(0);
  });

  test("pouring refuses when the aimed-face cell is occupied", () => {
    const { state, player, events } = makeFluidFixture(inventory([["water_bucket", 1]]), null);
    state.world.set(CELL.x, CELL.y, CELL.z, BlockId.Water); // already a fluid there
    expect(tryUseHeldItem(state, player, emitTo(events), () => 0.5)).toBe(false);
    expect(player.inventory[player.selectedSlot]?.id).toBe("water_bucket");
    expect(events).toHaveLength(0);
  });
});
