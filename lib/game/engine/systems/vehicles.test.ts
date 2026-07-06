import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BlockId, VoxelWorld } from "@/lib/world";
import { MINECART_BOOST_SPEED, MINECART_RIDE_HEIGHT, MINECART_SPEED } from "@/lib/game/config";
import { createBlockChangeTracker } from "@/lib/game/engine/blockChanges";
import type { FrameInput, GameEvent, GameState, PlayerState, VehicleState } from "@/lib/game/engine/state";
import { tickCoastingMinecarts, tickVehicles, tryPlaceVehicle } from "@/lib/game/engine/systems/vehicles";
import { createSlot } from "@/lib/game/items";

const FLOOR_Y = 10;
const RAIL_Y = FLOOR_Y + 1; // rails sit on the stone floor
const CART_Y = RAIL_Y + MINECART_RIDE_HEIGHT;

/** A 40³ world with a solid stone floor for track to sit on. */
function makeWorld(): VoxelWorld {
  const world = new VoxelWorld(40, 24, 40, 1);
  for (let x = 0; x < world.sizeX; x += 1) {
    for (let z = 0; z < world.sizeZ; z += 1) {
      world.set(x, FLOOR_Y, z, BlockId.Stone);
    }
  }
  return world;
}

function input(overrides: Partial<{ forward: boolean; back: boolean; left: boolean; right: boolean; crouch: boolean }> = {}): FrameInput {
  return {
    move: { forward: false, back: false, left: false, right: false, jump: false, sprint: false, crouch: false, ...overrides },
    mineHeld: false
  };
}

type Fixture = { state: GameState; events: GameEvent[]; emit: (e: GameEvent) => void; player: PlayerState };

function makeFixture(world = makeWorld()): Fixture {
  const player = {
    id: "local",
    position: new THREE.Vector3(2, RAIL_Y, 2),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    onGround: true,
    gameMode: "survival",
    mountedVehicleId: null,
    selectedSlot: 0,
    inventory: [createSlot("minecart", 1)]
  } as unknown as PlayerState;
  const events: GameEvent[] = [];
  const state = {
    world,
    blockChanges: createBlockChangeTracker(world),
    players: new Map([["local", player]]),
    player,
    vehicles: [] as VehicleState[],
    nextVehicleId: 1
  } as unknown as GameState;
  return { state, events, emit: (e) => events.push(e), player };
}

/** Lay a straight run of plain rail along +x at z, from x0 to x1 inclusive. */
function layTrackX(world: VoxelWorld, x0: number, x1: number, z: number, block: BlockId = BlockId.Rail): void {
  for (let x = x0; x <= x1; x += 1) world.set(x, RAIL_Y, z, block);
}

/** Spawn a cart directly (the placement path is tested separately). */
function spawnCart(fx: Fixture, x: number, z: number, yaw: number): VehicleState {
  const cart: VehicleState = { id: fx.state.nextVehicleId++, kind: "minecart", position: new THREE.Vector3(x, CART_Y, z), yaw, rider: null };
  fx.state.vehicles.push(cart);
  return cart;
}

function mount(fx: Fixture, cart: VehicleState): void {
  cart.rider = fx.player.id;
  fx.player.mountedVehicleId = cart.id;
}

/** Yaw that faces +x (east): forward = (-sin yaw, -cos yaw) = (1, 0). */
const YAW_EAST = -Math.PI / 2;

function run(fx: Fixture, frames: number, frameInput: FrameInput, dt = 0.1): void {
  for (let i = 0; i < frames; i += 1) tickVehicles(fx.state, fx.player, frameInput, dt);
}

describe("minecart placement", () => {
  test("aiming at a rail places a cart centered on it and consumes the item", () => {
    const fx = makeFixture();
    layTrackX(fx.state.world, 4, 8, 2);
    fx.player.position.set(6.5, RAIL_Y, 5.5);
    // Aim down-forward at the rail cell (6, RAIL_Y, 2): face -z and pitch down.
    fx.player.yaw = 0;
    fx.player.pitch = -Math.atan2(1.5, 3.5);
    expect(tryPlaceVehicle(fx.state, fx.player, fx.emit)).toBe(true);
    expect(fx.state.vehicles).toHaveLength(1);
    const cart = fx.state.vehicles[0];
    expect(cart.kind).toBe("minecart");
    expect(cart.position.x).toBeCloseTo(6.5);
    expect(cart.position.z).toBeCloseTo(2.5);
    expect(cart.position.y).toBeCloseTo(RAIL_Y + MINECART_RIDE_HEIGHT);
    expect(fx.player.inventory[0]?.id).not.toBe("minecart"); // stack of 1 consumed
    expect(fx.events).toContainEqual({ type: "vehiclePlaced", kind: "minecart" });
  });

  test("placement fails without a rail under the aim", () => {
    const fx = makeFixture();
    fx.player.position.set(6.5, RAIL_Y, 5.5);
    fx.player.pitch = -0.5; // aiming at the bare stone floor
    expect(tryPlaceVehicle(fx.state, fx.player, fx.emit)).toBe(true);
    expect(fx.state.vehicles).toHaveLength(0);
    expect(fx.player.inventory[0]?.id).toBe("minecart"); // item kept
    expect(fx.events).toContainEqual({ type: "vehiclePlaceFailed" });
  });
});

describe("mounted minecart", () => {
  test("throttling forward drives the cart along a straight track", () => {
    const fx = makeFixture();
    layTrackX(fx.state.world, 4, 20, 6);
    const cart = spawnCart(fx, 5.5, 6.5, YAW_EAST);
    mount(fx, cart);
    run(fx, 20, input({ forward: true }));
    expect(cart.position.x).toBeGreaterThan(8);
    expect(cart.position.z).toBeCloseTo(6.5); // rail-guided: never drifts off the centerline
    expect(fx.player.position.x).toBeCloseTo(cart.position.x); // rider synced
  });

  test("the cart turns at an L corner and continues on the new axis", () => {
    const fx = makeFixture();
    layTrackX(fx.state.world, 4, 10, 6); // east-west leg into (10, 6)
    for (let z = 6; z <= 16; z += 1) fx.state.world.set(10, RAIL_Y, z, BlockId.Rail); // south leg
    const cart = spawnCart(fx, 4.5, 6.5, YAW_EAST);
    mount(fx, cart);
    run(fx, 60, input({ forward: true }));
    expect(cart.position.x).toBeCloseTo(10.5); // locked onto the corner column
    expect(cart.position.z).toBeGreaterThan(8); // and heading south down the new leg
  });

  test("the cart stops centered on the last rail at end of track", () => {
    const fx = makeFixture();
    layTrackX(fx.state.world, 4, 8, 6);
    const cart = spawnCart(fx, 4.5, 6.5, YAW_EAST);
    mount(fx, cart);
    run(fx, 80, input({ forward: true }));
    expect(cart.position.x).toBeCloseTo(8.5);
    expect(cart.speed ?? 0).toBe(0);
  });

  test("mining the rail out from under a moving cart parks it", () => {
    const fx = makeFixture();
    layTrackX(fx.state.world, 4, 20, 6);
    const cart = spawnCart(fx, 4.5, 6.5, YAW_EAST);
    mount(fx, cart);
    run(fx, 5, input({ forward: true }));
    expect((cart.speed ?? 0) > 0).toBe(true);
    const cx = Math.floor(cart.position.x);
    fx.state.world.set(cx, RAIL_Y, 6, BlockId.Air); // the track vanishes underneath
    run(fx, 5, input({ forward: true }));
    expect(cart.speed ?? 0).toBe(0);
    expect(Math.floor(cart.position.x)).toBe(cx); // parked where the track ended
  });

  test("a lit powered rail boosts past cruise speed; an unlit one stops the cart", () => {
    const fx = makeFixture();
    layTrackX(fx.state.world, 4, 30, 6, BlockId.PoweredRailOn);
    const cart = spawnCart(fx, 4.5, 6.5, YAW_EAST);
    mount(fx, cart);
    run(fx, 30, input({ forward: true }));
    expect(cart.speed ?? 0).toBeGreaterThan(MINECART_SPEED);
    expect(cart.speed ?? 0).toBeLessThanOrEqual(MINECART_BOOST_SPEED + 1e-6);

    // Swap the track under the cart to an UNPOWERED powered rail: hard brake.
    const cx = Math.floor(cart.position.x);
    for (let x = cx; x <= cx + 6; x += 1) fx.state.world.set(x, RAIL_Y, 6, BlockId.PoweredRail);
    run(fx, 30, input({ forward: true }));
    expect(cart.speed ?? 0).toBe(0);
  });

  test("crouch dismounts beside the track", () => {
    const fx = makeFixture();
    layTrackX(fx.state.world, 4, 10, 6);
    const cart = spawnCart(fx, 6.5, 6.5, YAW_EAST);
    mount(fx, cart);
    run(fx, 1, input({ crouch: true }));
    expect(fx.player.mountedVehicleId).toBeNull();
    expect(cart.rider).toBeNull();
  });
});

describe("coasting minecarts", () => {
  test("a riderless cart coasts on and friction parks it", () => {
    const fx = makeFixture();
    layTrackX(fx.state.world, 4, 30, 6);
    const cart = spawnCart(fx, 5.5, 6.5, YAW_EAST);
    cart.speed = 5;
    for (let i = 0; i < 10; i += 1) tickCoastingMinecarts(fx.state, 0.1);
    const coastedTo = cart.position.x;
    expect(coastedTo).toBeGreaterThan(6.5); // kept rolling with nobody aboard
    for (let i = 0; i < 100; i += 1) tickCoastingMinecarts(fx.state, 0.1);
    expect(cart.speed ?? 0).toBe(0); // friction eventually parks it
  });

  test("a stationary cart on a lit powered rail launches the way it faces", () => {
    const fx = makeFixture();
    fx.state.world.set(5, RAIL_Y, 6, BlockId.PoweredRailOn);
    layTrackX(fx.state.world, 6, 20, 6);
    const cart = spawnCart(fx, 5.5, 6.5, YAW_EAST);
    for (let i = 0; i < 20; i += 1) tickCoastingMinecarts(fx.state, 0.1);
    expect(cart.position.x).toBeGreaterThan(6); // the launcher-track pattern
  });

  test("a parked cart whose rail is mined out reads as stranded, not launchable", () => {
    const fx = makeFixture();
    fx.state.world.set(5, RAIL_Y, 6, BlockId.PoweredRailOn);
    layTrackX(fx.state.world, 6, 12, 6);
    const cart = spawnCart(fx, 5.5, 6.5, YAW_EAST);
    fx.state.world.set(5, RAIL_Y, 6, BlockId.Air); // the rail vanishes under the parked cart
    // Even sitting on what WAS a lit launcher rail, the support check pins it.
    for (let i = 0; i < 20; i += 1) tickCoastingMinecarts(fx.state, 0.1);
    expect(cart.speed ?? 0).toBe(0);
    expect(cart.position.x).toBeCloseTo(5.5);
  });

  test("the per-player vehicle tick never moves a riderless cart", () => {
    const fx = makeFixture();
    layTrackX(fx.state.world, 4, 30, 6);
    const cart = spawnCart(fx, 5.5, 6.5, YAW_EAST);
    cart.speed = 5;
    // Two players ticking their vehicles must not integrate the coasting cart
    // (that is tickCoastingMinecarts' job, world-scoped, once per frame).
    run(fx, 10, input());
    run(fx, 10, input());
    expect(cart.position.x).toBeCloseTo(5.5);
  });
});
