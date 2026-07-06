import * as THREE from "three";
import { BlockId, collidesAt, isRailBlock, railAxis, voxelRaycast, waterSurfaceRaycast } from "@/lib/world";
import {
  EYE_HEIGHT,
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT,
  MAX_VEHICLES,
  MINECART_ACCEL,
  MINECART_BOOST_SPEED,
  MINECART_BRAKE_DECEL,
  MINECART_FRICTION,
  MINECART_HALF_LENGTH,
  MINECART_HALF_WIDTH,
  MINECART_RIDE_HEIGHT,
  MINECART_SPEED,
  RAFT_HALF_LENGTH,
  RAFT_HALF_WIDTH,
  RAFT_SPEED,
  SHIP_HALF_LENGTH,
  SHIP_HALF_WIDTH,
  SHIP_SPEED,
  VEHICLE_BOARD_REACH,
  VEHICLE_DISMOUNT_RADIUS,
  VEHICLE_TURN_RATE,
  WORLD_BORDER_PADDING
} from "@/lib/game/config";
import { adjustSlotCount } from "@/lib/game/inventory";
import type { VehicleKind } from "@/lib/game/types";
import type { EmitGameEvent, FrameInput, GameState, PlayerState, VehicleState } from "../state";
import { lookDirection } from "./playerMotion";

const scratchEye = new THREE.Vector3();
const scratchDir = new THREE.Vector3();
const scratchForward = new THREE.Vector3();
const scratchRight = new THREE.Vector3();
const scratchCandidate = new THREE.Vector3();

type VehicleSpec = {
  speed: number;
  halfWidth: number;
  halfLength: number;
};

const VEHICLE_SPECS: Record<VehicleKind, VehicleSpec> = {
  raft: { speed: RAFT_SPEED, halfWidth: RAFT_HALF_WIDTH, halfLength: RAFT_HALF_LENGTH },
  ship: { speed: SHIP_SPEED, halfWidth: SHIP_HALF_WIDTH, halfLength: SHIP_HALF_LENGTH },
  minecart: { speed: MINECART_SPEED, halfWidth: MINECART_HALF_WIDTH, halfLength: MINECART_HALF_LENGTH }
};

function specFor(kind: VehicleKind): VehicleSpec {
  return VEHICLE_SPECS[kind];
}

function makeVehicle(state: GameState, kind: VehicleKind, x: number, y: number, z: number, yaw: number): VehicleState {
  return {
    id: state.nextVehicleId++,
    kind,
    position: new THREE.Vector3(x, y, z),
    yaw,
    rider: null
  };
}

export function restoreVehicle(state: GameState, kind: VehicleKind, x: number, y: number, z: number, yaw: number): void {
  // Restore unconditionally — the pose was already field-validated in restoreVehicles.
  // We deliberately do NOT re-check water support or overlap here: the world under a
  // parked boat may have changed since it was saved (the player dug the water, built a
  // pier, etc.), and silently deleting a persisted, crafted entity is worse than keeping
  // a stuck one. Movement stays gated by canOccupy, so a beached boat still can't drive
  // onto land — it simply sits until the player frees it.
  state.vehicles.push(makeVehicle(state, kind, x, y, z, yaw));
}

// The four rotated footprint corners plus the center, reused across frames. The lone
// consumer (vehicleHasWaterSupport) reads it fully before returning and nothing else
// calls vehicleCorners concurrently, so a shared, allocation-free buffer is safe — in
// line with the scratch* vectors above and the engine's no-alloc-per-tick convention.
const scratchCorners: Array<[number, number]> = [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0]
];

function vehicleCorners(vehicle: VehicleState): Array<[number, number]> {
  const spec = specFor(vehicle.kind);
  const sin = Math.sin(vehicle.yaw);
  const cos = Math.cos(vehicle.yaw);
  const { x, z } = vehicle.position;
  const hw = spec.halfWidth;
  const hl = spec.halfLength;
  scratchCorners[0][0] = x - hw * cos + hl * sin;
  scratchCorners[0][1] = z - hw * sin - hl * cos;
  scratchCorners[1][0] = x - hw * cos - hl * sin;
  scratchCorners[1][1] = z - hw * sin + hl * cos;
  scratchCorners[2][0] = x + hw * cos + hl * sin;
  scratchCorners[2][1] = z + hw * sin - hl * cos;
  scratchCorners[3][0] = x + hw * cos - hl * sin;
  scratchCorners[3][1] = z + hw * sin + hl * cos;
  scratchCorners[4][0] = x;
  scratchCorners[4][1] = z;
  return scratchCorners;
}

function vehicleHasWaterSupport(state: GameState, vehicle: VehicleState): boolean {
  const waterY = Math.floor(vehicle.position.y - 0.2);
  const deckY = Math.floor(vehicle.position.y);
  for (const [x, z] of vehicleCorners(vehicle)) {
    const fx = Math.floor(x);
    const fz = Math.floor(z);
    if (state.world.get(fx, waterY, fz) !== BlockId.Water) return false;
    if (state.world.get(fx, deckY, fz) !== BlockId.Air) return false;
  }
  return true;
}

/** The rail cell a minecart rides on (the cart floats RIDE_HEIGHT above its base). */
function cartRailY(vehicle: VehicleState): number {
  return Math.floor(vehicle.position.y - 0.05);
}

function railBlockUnder(state: GameState, vehicle: VehicleState): number {
  return state.world.get(Math.floor(vehicle.position.x), cartRailY(vehicle), Math.floor(vehicle.position.z));
}

/** Per-kind ground truth: boats float on water, carts sit on a rail. */
function vehicleHasSupport(state: GameState, vehicle: VehicleState): boolean {
  if (vehicle.kind === "minecart") return isRailBlock(railBlockUnder(state, vehicle));
  return vehicleHasWaterSupport(state, vehicle);
}

function vehicleOverlaps(a: VehicleState, b: VehicleState): boolean {
  const as = specFor(a.kind);
  const bs = specFor(b.kind);
  const radiusA = Math.hypot(as.halfWidth, as.halfLength);
  const radiusB = Math.hypot(bs.halfWidth, bs.halfLength);
  return Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) < radiusA + radiusB;
}

function vehicleOverlapsAny(state: GameState, vehicle: VehicleState): boolean {
  return state.vehicles.some((other) => other.id !== vehicle.id && vehicleOverlaps(vehicle, other));
}

function canOccupy(state: GameState, vehicle: VehicleState): boolean {
  const spec = specFor(vehicle.kind);
  const radius = Math.hypot(spec.halfWidth, spec.halfLength);
  if (
    vehicle.position.x - radius < WORLD_BORDER_PADDING ||
    vehicle.position.z - radius < WORLD_BORDER_PADDING ||
    vehicle.position.x + radius > state.world.sizeX - WORLD_BORDER_PADDING ||
    vehicle.position.z + radius > state.world.sizeZ - WORLD_BORDER_PADDING
  ) {
    return false;
  }
  return vehicleHasSupport(state, vehicle) && !vehicleOverlapsAny(state, vehicle);
}

// --- Minecart rail-following -------------------------------------------------
//
// A cart's pose is (position snapped to the track centerline, yaw snapped to an
// axis, signed speed along that yaw). Movement hops cell centers: advance along
// the heading; at a center, prefer the straight-ahead rail, else a perpendicular
// neighbor (that IS the corner support — an L of plain rails just works), else
// stop dead on the center (end of track). There are no slopes and no cart-vs-cart
// collision (deferred); a rail mined out from under a cart parks it in place, the
// beached-boat philosophy.

const CART_EPS = 1e-4;

/** Snap a yaw to its dominant axis direction. */
function cartHeading(yaw: number): [number, number] {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  if (Math.abs(fx) >= Math.abs(fz)) return [fx >= 0 ? 1 : -1, 0];
  return [0, fz >= 0 ? 1 : -1];
}

/** Inverse of the forward vector (-sin yaw, -cos yaw) for an axis direction. */
function yawFor(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

function railAt(state: GameState, x: number, y: number, z: number): boolean {
  return isRailBlock(state.world.get(x, y, z));
}

/** Straight-ahead rail first, else a perpendicular turn (deterministic order). */
function pickNextRailCell(state: GameState, cx: number, cy: number, cz: number, dx: number, dz: number): [number, number] | null {
  if (railAt(state, cx + dx, cy, cz + dz)) return [dx, dz];
  const candidates: Array<[number, number]> =
    dx !== 0
      ? [
          [0, 1],
          [0, -1]
        ]
      : [
          [1, 0],
          [-1, 0]
        ];
  for (const [px, pz] of candidates) {
    if (railAt(state, cx + px, cy, cz + pz)) return [px, pz];
  }
  return null;
}

/**
 * Throttle is the rider's forward/back intent (0 while coasting). An unpowered
 * PoweredRail is a hard stopper; a lit one drives the cart toward the boost cap
 * (a stationary cart launches the way it faces — the button-powered launcher
 * track); otherwise the rider's throttle steers toward ±cruise speed and plain
 * rail bleeds speed off as friction.
 */
function updateMinecartSpeed(state: GameState, vehicle: VehicleState, throttle: number, dt: number): void {
  const approach = (value: number, target: number, maxDelta: number): number => {
    if (value < target) return Math.min(target, value + maxDelta);
    return Math.max(target, value - maxDelta);
  };
  const rail = railBlockUnder(state, vehicle);
  let speed = vehicle.speed ?? 0;
  if (rail === BlockId.PoweredRail) {
    speed = approach(speed, 0, MINECART_BRAKE_DECEL * dt);
  } else if (rail === BlockId.PoweredRailOn) {
    const dir = throttle !== 0 ? throttle : speed !== 0 ? Math.sign(speed) : 1;
    speed = approach(speed, dir * MINECART_BOOST_SPEED, MINECART_ACCEL * dt);
  } else if (throttle !== 0) {
    speed = approach(speed, throttle * MINECART_SPEED, MINECART_ACCEL * dt);
  } else {
    speed = approach(speed, 0, MINECART_FRICTION * dt);
  }
  vehicle.speed = speed;
}

function moveMinecartAlongRails(state: GameState, vehicle: VehicleState, dt: number): void {
  // Support check BEFORE the stationary early-return: a parked cart whose rail
  // was mined must read as stranded (speed pinned to 0) the same tick, not
  // only once something tries to move it.
  if (!vehicleHasSupport(state, vehicle)) {
    vehicle.speed = 0;
    return;
  }
  const signed = vehicle.speed ?? 0;
  let remaining = Math.abs(signed) * dt;
  if (remaining <= 0) return;
  let travelSign = Math.sign(signed);
  // Hard bound on cells per frame — protects against a huge dt (tab catch-up).
  let guard = 32;
  while (remaining > CART_EPS && guard-- > 0) {
    const cx = Math.floor(vehicle.position.x);
    const cy = cartRailY(vehicle);
    const cz = Math.floor(vehicle.position.z);
    if (!railAt(state, cx, cy, cz)) {
      vehicle.speed = 0; // track mined out from under a moving cart: park in place
      return;
    }
    const [hx, hz] = cartHeading(vehicle.yaw);
    const dx = hx * travelSign;
    const dz = hz * travelSign;
    const centerX = cx + 0.5;
    const centerZ = cz + 0.5;
    vehicle.position.y = cy + MINECART_RIDE_HEIGHT;
    // Approach the current cell's center first (also re-rails the cross axis).
    const toCenter = dx !== 0 ? (centerX - vehicle.position.x) * dx : (centerZ - vehicle.position.z) * dz;
    if (toCenter > CART_EPS) {
      const step = Math.min(remaining, toCenter);
      vehicle.position.x += dx * step;
      vehicle.position.z += dz * step;
      if (dx !== 0) vehicle.position.z = centerZ;
      else vehicle.position.x = centerX;
      remaining -= step;
      continue;
    }
    // At (or past) the center: pick where the track goes next.
    const next = pickNextRailCell(state, cx, cy, cz, dx, dz);
    if (!next) {
      vehicle.position.x = centerX;
      vehicle.position.z = centerZ;
      vehicle.speed = 0; // end of track: settle on the last rail
      return;
    }
    const [nx, nz] = next;
    if (nx !== dx || nz !== dz) {
      // The track turns: face the cart along the new travel direction. Speed
      // becomes positive-forward in the new frame (a reversing cart reorients).
      vehicle.yaw = yawFor(nx, nz);
      vehicle.speed = Math.abs(vehicle.speed ?? 0);
      travelSign = 1;
    }
    const targetX = cx + nx + 0.5;
    const targetZ = cz + nz + 0.5;
    const dist = nx !== 0 ? (targetX - vehicle.position.x) * nx : (targetZ - vehicle.position.z) * nz;
    const step = Math.min(remaining, dist);
    vehicle.position.x += nx * step;
    vehicle.position.z += nz * step;
    if (nx !== 0) vehicle.position.z = centerZ;
    else vehicle.position.x = centerX;
    remaining -= step;
  }
}

function tickMountedMinecart(state: GameState, player: PlayerState, vehicle: VehicleState, input: FrameInput, dt: number): void {
  const throttle = (input.move.forward ? 1 : 0) - (input.move.back ? 1 : 0);
  updateMinecartSpeed(state, vehicle, throttle, dt);
  moveMinecartAlongRails(state, vehicle, dt);
  syncPlayerToVehicle(player, vehicle);
}

/**
 * Riderless carts coast under the same friction/boost rules, so a lever-powered
 * launcher track works with nobody aboard. World-scoped and called exactly once
 * per frame from GameEngine.step — NOT the per-player tickVehicles path, which
 * runs once per player and would integrate a coasting cart N× in co-op.
 */
export function tickCoastingMinecarts(state: GameState, dt: number): void {
  for (const vehicle of state.vehicles) {
    if (vehicle.kind !== "minecart" || vehicle.rider !== null) continue;
    updateMinecartSpeed(state, vehicle, 0, dt);
    moveMinecartAlongRails(state, vehicle, dt);
  }
}

function mountVehicle(state: GameState, player: PlayerState, vehicle: VehicleState): void {
  if (player.mountedVehicleId !== null) {
    const current = state.vehicles.find((v) => v.id === player.mountedVehicleId);
    if (current) current.rider = null;
  }
  vehicle.rider = player.id;
  player.mountedVehicleId = vehicle.id;
  syncPlayerToVehicle(player, vehicle);
}

function dismountVehicle(state: GameState, player: PlayerState, vehicle: VehicleState): boolean {
  const spec = specFor(vehicle.kind);
  const offsets = [
    [0, spec.halfLength + 0.8],
    [0, -spec.halfLength - 0.8],
    [spec.halfWidth + 0.8, 0],
    [-spec.halfWidth - 0.8, 0],
    [VEHICLE_DISMOUNT_RADIUS, VEHICLE_DISMOUNT_RADIUS],
    [-VEHICLE_DISMOUNT_RADIUS, VEHICLE_DISMOUNT_RADIUS],
    [VEHICLE_DISMOUNT_RADIUS, -VEHICLE_DISMOUNT_RADIUS],
    [-VEHICLE_DISMOUNT_RADIUS, -VEHICLE_DISMOUNT_RADIUS]
  ];
  const sin = Math.sin(vehicle.yaw);
  const cos = Math.cos(vehicle.yaw);
  for (const [lx, lz] of offsets) {
    const x = vehicle.position.x + lx * cos - lz * sin;
    const z = vehicle.position.z + lx * sin + lz * cos;
    for (let y = Math.floor(vehicle.position.y + 1); y >= Math.floor(vehicle.position.y - 1); y -= 1) {
      scratchCandidate.set(x, y, z);
      if (collidesAt(state.world, scratchCandidate, PLAYER_HALF_WIDTH, PLAYER_HEIGHT)) continue;
      vehicle.rider = null;
      player.mountedVehicleId = null;
      player.position.copy(scratchCandidate);
      player.velocity.set(0, 0, 0);
      player.onGround = false;
      return true;
    }
  }
  return false;
}

function syncPlayerToVehicle(player: PlayerState, vehicle: VehicleState): void {
  player.position.set(vehicle.position.x, vehicle.position.y + 0.16, vehicle.position.z);
  // The rider's own velocity is inert while mounted (player motion is skipped); keep it
  // zeroed so a later dismount starts from rest rather than inheriting a stale value.
  player.velocity.set(0, 0, 0);
  player.onGround = true;
}

function aimedVehicle(state: GameState, player: PlayerState): VehicleState | null {
  scratchEye.set(player.position.x, player.position.y + EYE_HEIGHT, player.position.z);
  lookDirection(player.yaw, player.pitch, scratchDir);
  let best: VehicleState | null = null;
  let bestT = VEHICLE_BOARD_REACH;
  for (const vehicle of state.vehicles) {
    const to = scratchCandidate.copy(vehicle.position).sub(scratchEye);
    const t = to.dot(scratchDir);
    if (t < 0 || t > bestT) continue;
    const closestX = scratchEye.x + scratchDir.x * t;
    const closestY = scratchEye.y + scratchDir.y * t;
    const closestZ = scratchEye.z + scratchDir.z * t;
    const spec = specFor(vehicle.kind);
    const radius = Math.hypot(spec.halfWidth, spec.halfLength);
    if (Math.hypot(vehicle.position.x - closestX, vehicle.position.y - closestY, vehicle.position.z - closestZ) > radius) continue;
    best = vehicle;
    bestT = t;
  }
  return best;
}

export function tryBoardAimedVehicle(state: GameState, player: PlayerState, emit: EmitGameEvent): boolean {
  const vehicle = aimedVehicle(state, player);
  if (!vehicle || vehicle.rider !== null) return false;
  mountVehicle(state, player, vehicle);
  emit({ type: "vehicleBoarded", kind: vehicle.kind });
  return true;
}

export function tryPlaceVehicle(state: GameState, player: PlayerState, emit: EmitGameEvent): boolean {
  const slot = player.inventory[player.selectedSlot];
  if (slot?.id !== "raft" && slot?.id !== "ship" && slot?.id !== "minecart") return false;
  const kind = slot.id;
  if (state.vehicles.length >= MAX_VEHICLES) {
    emit({ type: "vehiclePlaceFailed" }); // world is at the vehicle cap — refuse to keep saves bounded
    return true;
  }
  scratchEye.set(player.position.x, player.position.y + EYE_HEIGHT, player.position.z);
  lookDirection(player.yaw, player.pitch, scratchDir);
  let vehicle: VehicleState;
  if (kind === "minecart") {
    // A cart places onto the rail block you aim at (rails are raycast-solid),
    // facing along the track's axis toward wherever the player is looking.
    const hit = voxelRaycast(state.world, scratchEye, scratchDir, VEHICLE_BOARD_REACH);
    const rail = hit ? state.world.get(hit.hit.x, hit.hit.y, hit.hit.z) : BlockId.Air;
    if (!hit || !isRailBlock(rail)) {
      emit({ type: "vehiclePlaceFailed" }); // not aiming at a rail — cue the "can't place here" thud
      return true;
    }
    const axis = railAxis(state.world, hit.hit.x, hit.hit.y, hit.hit.z);
    const fx = -Math.sin(player.yaw);
    const fz = -Math.cos(player.yaw);
    const yaw = axis === "x" ? yawFor(fx >= 0 ? 1 : -1, 0) : yawFor(0, fz >= 0 ? 1 : -1);
    vehicle = makeVehicle(state, kind, hit.hit.x + 0.5, hit.hit.y + MINECART_RIDE_HEIGHT, hit.hit.z + 0.5, yaw);
  } else {
    const water = waterSurfaceRaycast(state.world, scratchEye, scratchDir, VEHICLE_BOARD_REACH);
    if (!water) {
      emit({ type: "vehiclePlaceFailed" }); // no water in reach — cue the "can't place here" thud
      return true;
    }
    vehicle = makeVehicle(state, kind, water.x + 0.5, water.y + 1, water.z + 0.5, player.yaw);
  }
  if (!canOccupy(state, vehicle)) {
    emit({ type: "vehiclePlaceFailed" }); // spot is blocked, out of bounds, or overlaps another vehicle
    return true;
  }
  state.vehicles.push(vehicle);
  if (player.gameMode !== "creative") player.inventory = adjustSlotCount(player.inventory, kind, -1, player.selectedSlot) ?? player.inventory;
  emit({ type: "vehiclePlaced", kind });
  return true;
}

export function tickVehicles(state: GameState, player: PlayerState, input: FrameInput, dt: number): void {
  const mounted = player.mountedVehicleId === null ? null : (state.vehicles.find((vehicle) => vehicle.id === player.mountedVehicleId) ?? null);
  if (mounted) {
    if (input.move.crouch && dismountVehicle(state, player, mounted)) return;
    if (mounted.kind === "minecart") {
      // Rail-guided: the track steers, the rider only throttles and brakes.
      tickMountedMinecart(state, player, mounted, input, dt);
      return;
    }
    const forwardInput = (input.move.forward ? 1 : 0) - (input.move.back ? 1 : 0);
    const turnInput = (input.move.right ? 1 : 0) - (input.move.left ? 1 : 0);
    mounted.yaw -= turnInput * VEHICLE_TURN_RATE * dt;
    scratchForward.set(-Math.sin(mounted.yaw), 0, -Math.cos(mounted.yaw));
    const speed = specFor(mounted.kind).speed * forwardInput;
    const prevX = mounted.position.x;
    const prevZ = mounted.position.z;
    mounted.position.x += scratchForward.x * speed * dt;
    mounted.position.z += scratchForward.z * speed * dt;
    if (!canOccupy(state, mounted)) {
      mounted.position.x = prevX;
      mounted.position.z = prevZ;
    }
    syncPlayerToVehicle(player, mounted);
    return;
  }

  for (const vehicle of state.vehicles) {
    if (vehicle.kind !== "ship" || vehicle.rider !== null) continue;
    const spec = specFor(vehicle.kind);
    scratchRight.set(Math.cos(vehicle.yaw), 0, Math.sin(vehicle.yaw));
    scratchForward.set(-Math.sin(vehicle.yaw), 0, -Math.cos(vehicle.yaw));
    const dx = player.position.x - vehicle.position.x;
    const dz = player.position.z - vehicle.position.z;
    const localX = dx * scratchRight.x + dz * scratchRight.z;
    const localZ = dx * scratchForward.x + dz * scratchForward.z;
    if (Math.abs(localX) <= spec.halfWidth && Math.abs(localZ) <= spec.halfLength && Math.abs(player.position.y - vehicle.position.y) <= 1.2) {
      mountVehicle(state, player, vehicle);
      break;
    }
  }
}
