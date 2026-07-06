import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BlockId, VoxelWorld } from "@/lib/world";
import { REDSTONE_BUTTON_PRESS_SECONDS, REDSTONE_TICK_SECONDS, REDSTONE_WIRE_RANGE } from "@/lib/game/config";
import { createBlockChangeTracker } from "@/lib/game/engine/blockChanges";
import type { GameEvent, GameState, MobState, PlayerState, RedstoneState, VehicleState } from "@/lib/game/engine/state";
import { createRedstoneState, pressButton, seedRedstoneCells, tickRedstone, toggleLever, trackRedstoneCell } from "@/lib/game/engine/systems/redstone";

const FLOOR_Y = 10;
const Y = FLOOR_Y + 1; // components sit on the floor

/** A 40³ world with a solid stone floor for circuits to sit on. */
function makeWorld(): VoxelWorld {
  const world = new VoxelWorld(40, 24, 40, 1);
  for (let x = 0; x < world.sizeX; x += 1) {
    for (let z = 0; z < world.sizeZ; z += 1) {
      world.set(x, FLOOR_Y, z, BlockId.Stone);
    }
  }
  return world;
}

function makeMob(x: number, y: number, z: number): MobState {
  return {
    id: 1,
    kind: "zombie",
    hostile: true,
    faction: "hostile",
    targetId: null,
    retargetTimer: 0,
    hp: 20,
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

type Fixture = { state: GameState; events: GameEvent[]; emit: (e: GameEvent) => void; player: PlayerState; redstone: RedstoneState };

function makeFixture(world = makeWorld(), mobs: MobState[] = []): Fixture {
  const player = {
    id: "local",
    position: new THREE.Vector3(2, Y, 2),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    onGround: true
  } as unknown as PlayerState;
  const redstone = createRedstoneState();
  const events: GameEvent[] = [];
  const state = {
    world,
    blockChanges: createBlockChangeTracker(world),
    players: new Map([["local", player]]),
    player,
    mobs,
    vehicles: [],
    primedTnt: new Map<number, number>(),
    redstone,
    worldMeshDirty: false
  } as unknown as GameState;
  return { state, events, emit: (e) => events.push(e), player, redstone };
}

/** Place a block through the tracker and register it with the power system. */
function place(fx: Fixture, x: number, y: number, z: number, block: BlockId): void {
  fx.state.blockChanges.set(x, y, z, block);
  trackRedstoneCell(fx.state, x, y, z);
}

/** Run exactly one power pass (the accumulator needs a full tick). */
function pass(fx: Fixture): void {
  tickRedstone(fx.state, REDSTONE_TICK_SECONDS, fx.emit);
}

describe("redstone power", () => {
  test("a lever powers wire into a lamp, and off again", () => {
    const fx = makeFixture();
    place(fx, 10, Y, 10, BlockId.Lever);
    place(fx, 11, Y, 10, BlockId.RedstoneWire);
    place(fx, 12, Y, 10, BlockId.RedstoneWire);
    place(fx, 13, Y, 10, BlockId.RedstoneLamp);

    expect(toggleLever(fx.state, fx.emit, 10, Y, 10)).toBe(true);
    expect(fx.state.world.get(10, Y, 10)).toBe(BlockId.LeverOn);
    pass(fx);
    expect(fx.state.world.get(11, Y, 10)).toBe(BlockId.RedstoneWireOn);
    expect(fx.state.world.get(12, Y, 10)).toBe(BlockId.RedstoneWireOn);
    expect(fx.state.world.get(13, Y, 10)).toBe(BlockId.RedstoneLampOn);
    expect(fx.events).toContainEqual({ type: "lampToggled", on: true });

    expect(toggleLever(fx.state, fx.emit, 10, Y, 10)).toBe(true);
    pass(fx);
    expect(fx.state.world.get(11, Y, 10)).toBe(BlockId.RedstoneWire);
    expect(fx.state.world.get(13, Y, 10)).toBe(BlockId.RedstoneLamp);
    expect(fx.events).toContainEqual({ type: "lampToggled", on: false });
  });

  test("the signal runs out after REDSTONE_WIRE_RANGE wire cells", () => {
    const fx = makeFixture();
    place(fx, 2, Y, 20, BlockId.LeverOn);
    // Wire cells 1..RANGE+1 east of the lever; budget reaches exactly RANGE cells.
    for (let i = 1; i <= REDSTONE_WIRE_RANGE + 1; i += 1) place(fx, 2 + i, Y, 20, BlockId.RedstoneWire);
    pass(fx);
    expect(fx.state.world.get(2 + REDSTONE_WIRE_RANGE, Y, 20)).toBe(BlockId.RedstoneWireOn);
    expect(fx.state.world.get(2 + REDSTONE_WIRE_RANGE + 1, Y, 20)).toBe(BlockId.RedstoneWire);
  });

  test("wire climbs one-block slopes", () => {
    const fx = makeFixture();
    // A step: floor at FLOOR_Y, then a stone step so the next wire sits one higher.
    fx.state.world.set(12, Y, 20, BlockId.Stone);
    place(fx, 10, Y, 20, BlockId.LeverOn);
    place(fx, 11, Y, 20, BlockId.RedstoneWire);
    place(fx, 12, Y + 1, 20, BlockId.RedstoneWire); // up the step
    place(fx, 13, Y + 1, 20, BlockId.RedstoneLamp); // fed by the upper wire
    fx.state.world.set(13, Y, 20, BlockId.Stone); // support under the lamp
    pass(fx);
    expect(fx.state.world.get(12, Y + 1, 20)).toBe(BlockId.RedstoneWireOn);
    expect(fx.state.world.get(13, Y + 1, 20)).toBe(BlockId.RedstoneLampOn);
  });

  test("a redstone torch inverts its support and never feeds itself", () => {
    const fx = makeFixture();
    // Torch on a stone pillar; a lever's wire powers the pillar.
    fx.state.world.set(20, Y, 20, BlockId.Stone); // the pillar (at component height)
    place(fx, 20, Y + 1, 20, BlockId.RedstoneTorch);
    place(fx, 19, Y, 20, BlockId.RedstoneWire);
    place(fx, 18, Y, 20, BlockId.Lever);

    // Unpowered pillar: the torch stays lit pass after pass (no self-feedback).
    pass(fx);
    pass(fx);
    expect(fx.state.world.get(20, Y + 1, 20)).toBe(BlockId.RedstoneTorch);

    // Power the pillar: the torch turns off on the next pass.
    toggleLever(fx.state, fx.emit, 18, Y, 20);
    pass(fx);
    expect(fx.state.world.get(20, Y + 1, 20)).toBe(BlockId.RedstoneTorchOff);

    // Cut the power: it relights.
    toggleLever(fx.state, fx.emit, 18, Y, 20);
    pass(fx);
    expect(fx.state.world.get(20, Y + 1, 20)).toBe(BlockId.RedstoneTorch);
  });

  test("a torch clock oscillates with a two-pass period", () => {
    const fx = makeFixture();
    // The torch's output loops back to its own support pillar: torch on the
    // pillar powers a raised wire, which steps down and wraps around to a
    // floor wire touching the pillar's side.
    fx.state.world.set(20, Y, 20, BlockId.Stone); // the pillar
    place(fx, 20, Y + 1, 20, BlockId.RedstoneTorch);
    fx.state.world.set(20, Y, 19, BlockId.Stone); // support for the raised wire
    place(fx, 20, Y + 1, 19, BlockId.RedstoneWire); // fed by the torch's north face
    place(fx, 19, Y, 19, BlockId.RedstoneWire); // steps down-west
    place(fx, 19, Y, 20, BlockId.RedstoneWire); // wraps south; touches the pillar

    // Pass 1: the lit torch drives the loop on, and — the pillar now being in
    // this pass's powered set — turns itself off in the same pass.
    pass(fx);
    expect(fx.state.world.get(19, Y, 20)).toBe(BlockId.RedstoneWireOn);
    expect(fx.state.world.get(20, Y + 1, 20)).toBe(BlockId.RedstoneTorchOff);
    // Pass 2: no source left — the loop drops out and the torch relights.
    pass(fx);
    expect(fx.state.world.get(19, Y, 20)).toBe(BlockId.RedstoneWire);
    expect(fx.state.world.get(20, Y + 1, 20)).toBe(BlockId.RedstoneTorch);
    // Pass 3: same as pass 1 — a stable two-pass oscillation.
    pass(fx);
    expect(fx.state.world.get(19, Y, 20)).toBe(BlockId.RedstoneWireOn);
    expect(fx.state.world.get(20, Y + 1, 20)).toBe(BlockId.RedstoneTorchOff);
  });

  test("a button pops back after its press window and heals a timerless reload", () => {
    const fx = makeFixture();
    place(fx, 10, Y, 10, BlockId.RedstoneButton);
    expect(pressButton(fx.state, fx.emit, 10, Y, 10)).toBe(true);
    expect(fx.state.world.get(10, Y, 10)).toBe(BlockId.RedstoneButtonOn);
    expect(fx.events).toContainEqual({ type: "buttonPressed" });

    // Stays pressed through the window, pops back after it.
    const passes = Math.ceil(REDSTONE_BUTTON_PRESS_SECONDS / REDSTONE_TICK_SECONDS);
    for (let i = 0; i < passes; i += 1) {
      expect(fx.state.world.get(10, Y, 10)).toBe(BlockId.RedstoneButtonOn);
      pass(fx);
    }
    expect(fx.state.world.get(10, Y, 10)).toBe(BlockId.RedstoneButton);

    // Reload heal: a pressed button with no timer entry (saved mid-press) pops
    // back on the first pass.
    place(fx, 12, Y, 10, BlockId.RedstoneButtonOn);
    pass(fx);
    expect(fx.state.world.get(12, Y, 10)).toBe(BlockId.RedstoneButton);
  });

  test("a plate presses under a player or a mob and releases when vacated", () => {
    const mob = makeMob(30, Y + 0.9, 30);
    const fx = makeFixture(makeWorld(), [mob]);
    place(fx, 10, Y, 10, BlockId.PressurePlate);
    place(fx, 30, Y, 30, BlockId.PressurePlate);

    fx.player.position.set(10.5, Y, 10.5); // feet in the plate cell
    pass(fx);
    expect(fx.state.world.get(10, Y, 10)).toBe(BlockId.PressurePlateOn);
    expect(fx.state.world.get(30, Y, 30)).toBe(BlockId.PressurePlateOn); // the mob's plate
    expect(fx.events).toContainEqual({ type: "plateToggled", on: true });

    fx.player.position.set(2, Y, 2);
    fx.state.mobs = [];
    pass(fx);
    expect(fx.state.world.get(10, Y, 10)).toBe(BlockId.PressurePlate);
    expect(fx.state.world.get(30, Y, 30)).toBe(BlockId.PressurePlate);
    expect(fx.events).toContainEqual({ type: "plateToggled", on: false });
  });

  test("doors force open on a rising edge, closed on a falling edge, and stay manual between", () => {
    const fx = makeFixture();
    // A closed door pair next to a lever-fed wire.
    fx.state.blockChanges.set(12, Y, 10, BlockId.DoorNorthLower);
    fx.state.blockChanges.set(12, Y + 1, 10, BlockId.DoorNorthUpper);
    place(fx, 10, Y, 10, BlockId.Lever);
    place(fx, 11, Y, 10, BlockId.RedstoneWire);

    toggleLever(fx.state, fx.emit, 10, Y, 10);
    pass(fx);
    expect(fx.state.world.get(12, Y, 10)).toBe(BlockId.DoorNorthOpenLower); // rising edge forced it open
    expect(fx.events).toContainEqual({ type: "doorToggled", open: true });

    // Manually close it while still powered: the pass must NOT fight the player.
    fx.state.blockChanges.set(12, Y, 10, BlockId.DoorNorthLower);
    fx.state.blockChanges.set(12, Y + 1, 10, BlockId.DoorNorthUpper);
    pass(fx);
    expect(fx.state.world.get(12, Y, 10)).toBe(BlockId.DoorNorthLower); // stays hand-closed

    toggleLever(fx.state, fx.emit, 10, Y, 10); // cut power
    pass(fx);
    // Falling edge forces closed — already closed, so it just stays.
    expect(fx.state.world.get(12, Y, 10)).toBe(BlockId.DoorNorthLower);
  });

  test("powered TNT lights its fuse", () => {
    const fx = makeFixture();
    fx.state.blockChanges.set(12, Y, 10, BlockId.Tnt);
    place(fx, 10, Y, 10, BlockId.LeverOn);
    place(fx, 11, Y, 10, BlockId.RedstoneWire);
    pass(fx);
    expect(fx.state.primedTnt.has(fx.state.world.index(12, Y, 10))).toBe(true);
    expect(fx.events).toContainEqual({ type: "tntPrimed", x: 12, y: Y, z: 10 });
  });

  test("self-heal drops overwritten cells and pops orphaned overlays", () => {
    const fx = makeFixture();
    place(fx, 10, Y, 10, BlockId.RedstoneWire);
    place(fx, 12, Y, 10, BlockId.Lever);
    // The wire cell gets overwritten (e.g. by an explosion or a server delta).
    fx.state.world.set(10, Y, 10, BlockId.Air);
    // The lever's support vanishes.
    fx.state.world.set(12, FLOOR_Y, 10, BlockId.Air);
    pass(fx);
    expect(fx.redstone.cells.has(fx.state.world.index(10, Y, 10))).toBe(false);
    expect(fx.state.world.get(12, Y, 10)).toBe(BlockId.Air); // orphan popped
    expect(fx.redstone.cells.has(fx.state.world.index(12, Y, 10))).toBe(false);
  });

  test("a stable circuit writes nothing across passes", () => {
    const fx = makeFixture();
    place(fx, 10, Y, 10, BlockId.LeverOn);
    place(fx, 11, Y, 10, BlockId.RedstoneWire);
    place(fx, 12, Y, 10, BlockId.RedstoneLamp);
    pass(fx); // settle
    fx.state.blockChanges.drainEditsDetailed(); // clear the journal
    fx.state.worldMeshDirty = false;
    pass(fx);
    pass(fx);
    expect(fx.state.blockChanges.drainEditsDetailed()).toHaveLength(0);
    expect(fx.state.worldMeshDirty).toBe(false);
  });

  test("seedRedstoneCells recovers every component from the block diff", () => {
    const fx = makeFixture();
    // Written through the tracker (as placement does) but NOT tracked — a
    // fresh boot rebuilds the set from the diff alone.
    fx.state.blockChanges.set(10, Y, 10, BlockId.LeverOn);
    fx.state.blockChanges.set(11, Y, 10, BlockId.RedstoneWire);
    fx.state.blockChanges.set(12, Y, 10, BlockId.RedstoneLamp);
    expect(fx.redstone.cells.size).toBe(0);
    seedRedstoneCells(fx.state);
    expect(fx.redstone.cells.size).toBe(3);
    pass(fx);
    expect(fx.state.world.get(12, Y, 10)).toBe(BlockId.RedstoneLampOn);
  });
});

describe("rails in the power pass", () => {
  function parkCart(fx: Fixture, x: number, z: number): void {
    (fx.state.vehicles as VehicleState[]).push({
      id: 99,
      kind: "minecart",
      position: new THREE.Vector3(x, Y + 0.1, z),
      yaw: 0,
      rider: null
    });
  }

  test("a lever switches a powered rail on and off", () => {
    const fx = makeFixture();
    place(fx, 10, Y, 10, BlockId.Lever);
    place(fx, 11, Y, 10, BlockId.PoweredRail);
    expect(toggleLever(fx.state, fx.emit, 10, Y, 10)).toBe(true);
    pass(fx);
    expect(fx.state.world.get(11, Y, 10)).toBe(BlockId.PoweredRailOn);
    expect(toggleLever(fx.state, fx.emit, 10, Y, 10)).toBe(true);
    pass(fx);
    expect(fx.state.world.get(11, Y, 10)).toBe(BlockId.PoweredRail);
  });

  test("a parked cart trips a detector rail, which powers a lamp like a plate", () => {
    const fx = makeFixture();
    place(fx, 10, Y, 10, BlockId.DetectorRail);
    place(fx, 11, Y, 10, BlockId.RedstoneLamp);
    parkCart(fx, 10.5, 10.5);
    pass(fx); // detector flips on
    pass(fx); // and sources the lamp on the next derivation
    expect(fx.state.world.get(10, Y, 10)).toBe(BlockId.DetectorRailOn);
    expect(fx.state.world.get(11, Y, 10)).toBe(BlockId.RedstoneLampOn);
    expect(fx.events).toContainEqual({ type: "detectorToggled", on: true });

    fx.state.vehicles.length = 0; // the cart rolls away
    pass(fx);
    pass(fx);
    expect(fx.state.world.get(10, Y, 10)).toBe(BlockId.DetectorRail);
    expect(fx.state.world.get(11, Y, 10)).toBe(BlockId.RedstoneLamp);
    expect(fx.events).toContainEqual({ type: "detectorToggled", on: false });
  });

  test("a parked cart holds a pressure plate down", () => {
    const fx = makeFixture();
    place(fx, 10, Y, 10, BlockId.PressurePlate);
    parkCart(fx, 10.5, 10.5);
    pass(fx);
    expect(fx.state.world.get(10, Y, 10)).toBe(BlockId.PressurePlateOn);
  });

  test("a rail pops off when its support block vanishes", () => {
    const fx = makeFixture();
    place(fx, 10, Y, 10, BlockId.Rail);
    place(fx, 11, Y, 10, BlockId.PoweredRail);
    fx.state.blockChanges.set(10, FLOOR_Y, 10, BlockId.Air); // the floor under the plain rail goes
    pass(fx);
    expect(fx.state.world.get(10, Y, 10)).toBe(BlockId.Air);
    expect(fx.state.world.get(11, Y, 10)).toBe(BlockId.PoweredRail); // its neighbor keeps its floor
    expect(fx.redstone.cells.has(fx.state.world.index(10, Y, 10))).toBe(false);
  });

  test("seedRedstoneCells recovers plain rails from the block diff", () => {
    const fx = makeFixture();
    fx.state.blockChanges.set(10, Y, 10, BlockId.Rail);
    fx.state.blockChanges.set(11, Y, 10, BlockId.DetectorRail);
    seedRedstoneCells(fx.state);
    expect(fx.redstone.cells.size).toBe(2);
    // The seeded plain rail self-heals like any tracked cell.
    fx.state.blockChanges.set(10, FLOOR_Y, 10, BlockId.Air);
    pass(fx);
    expect(fx.state.world.get(10, Y, 10)).toBe(BlockId.Air);
  });
});
