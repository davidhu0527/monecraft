import * as THREE from "three";
import { BlockId, collidesAt, waterSurfaceRaycast } from "@/lib/world";
import {
  EYE_HEIGHT,
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT,
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
import type { EmitGameEvent, FrameInput, GameState, VehicleState } from "../state";
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
  ship: { speed: SHIP_SPEED, halfWidth: SHIP_HALF_WIDTH, halfLength: SHIP_HALF_LENGTH }
};

function specFor(kind: VehicleKind): VehicleSpec {
  return VEHICLE_SPECS[kind];
}

function makeVehicle(state: GameState, kind: VehicleKind, x: number, y: number, z: number, yaw: number): VehicleState {
  return {
    id: state.nextVehicleId++,
    kind,
    position: new THREE.Vector3(x, y, z),
    velocity: new THREE.Vector3(),
    yaw,
    rider: null
  };
}

export function restoreVehicle(state: GameState, kind: VehicleKind, x: number, y: number, z: number, yaw: number): void {
  const vehicle = makeVehicle(state, kind, x, y, z, yaw);
  if (vehicleHasWaterSupport(state, vehicle) && !vehicleOverlapsAny(state, vehicle)) state.vehicles.push(vehicle);
}

function vehicleCorners(vehicle: VehicleState): Array<[number, number]> {
  const spec = specFor(vehicle.kind);
  const sin = Math.sin(vehicle.yaw);
  const cos = Math.cos(vehicle.yaw);
  const points: Array<[number, number]> = [];
  for (const lx of [-spec.halfWidth, spec.halfWidth]) {
    for (const lz of [-spec.halfLength, spec.halfLength]) {
      points.push([vehicle.position.x + lx * cos - lz * sin, vehicle.position.z + lx * sin + lz * cos]);
    }
  }
  points.push([vehicle.position.x, vehicle.position.z]);
  return points;
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
  return vehicleHasWaterSupport(state, vehicle) && !vehicleOverlapsAny(state, vehicle);
}

function mountVehicle(state: GameState, vehicle: VehicleState): void {
  if (state.mountedVehicleId !== null) {
    const current = state.vehicles.find((v) => v.id === state.mountedVehicleId);
    if (current) current.rider = null;
  }
  vehicle.rider = "player";
  state.mountedVehicleId = vehicle.id;
  syncPlayerToVehicle(state, vehicle);
}

function dismountVehicle(state: GameState, vehicle: VehicleState): boolean {
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
      state.mountedVehicleId = null;
      state.player.position.copy(scratchCandidate);
      state.player.velocity.set(0, 0, 0);
      state.player.onGround = false;
      return true;
    }
  }
  return false;
}

function syncPlayerToVehicle(state: GameState, vehicle: VehicleState): void {
  state.player.position.set(vehicle.position.x, vehicle.position.y + 0.16, vehicle.position.z);
  state.player.velocity.copy(vehicle.velocity);
  state.player.onGround = true;
}

function aimedVehicle(state: GameState): VehicleState | null {
  const { player } = state;
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

export function tryBoardAimedVehicle(state: GameState): boolean {
  const vehicle = aimedVehicle(state);
  if (!vehicle || vehicle.rider !== null) return false;
  mountVehicle(state, vehicle);
  return true;
}

export function tryPlaceVehicle(state: GameState, emit: EmitGameEvent): boolean {
  const slot = state.inventory[state.selectedSlot];
  if (slot?.id !== "raft" && slot?.id !== "ship") return false;
  const kind = slot.id;
  scratchEye.set(state.player.position.x, state.player.position.y + EYE_HEIGHT, state.player.position.z);
  lookDirection(state.player.yaw, state.player.pitch, scratchDir);
  const water = waterSurfaceRaycast(state.world, scratchEye, scratchDir, VEHICLE_BOARD_REACH);
  if (!water) return true;
  const vehicle = makeVehicle(state, kind, water.x + 0.5, water.y + 1, water.z + 0.5, state.player.yaw);
  if (!canOccupy(state, vehicle)) return true;
  state.vehicles.push(vehicle);
  if (state.gameMode !== "creative") state.inventory = adjustSlotCount(state.inventory, kind, -1, state.selectedSlot) ?? state.inventory;
  emit({ type: "vehiclePlaced", kind });
  return true;
}

export function tickVehicles(state: GameState, input: FrameInput, dt: number): { horizontalDistance: number } {
  for (const vehicle of state.vehicles) vehicle.velocity.set(0, 0, 0);

  const mounted = state.mountedVehicleId === null ? null : (state.vehicles.find((vehicle) => vehicle.id === state.mountedVehicleId) ?? null);
  if (mounted) {
    if (input.keys.has("KeyC") && dismountVehicle(state, mounted)) return { horizontalDistance: 0 };
    const forwardInput = (input.keys.has("KeyW") ? 1 : 0) - (input.keys.has("KeyS") ? 1 : 0);
    const turnInput = (input.keys.has("KeyD") ? 1 : 0) - (input.keys.has("KeyA") ? 1 : 0);
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
    mounted.velocity.set((mounted.position.x - prevX) / Math.max(dt, 1e-6), 0, (mounted.position.z - prevZ) / Math.max(dt, 1e-6));
    syncPlayerToVehicle(state, mounted);
    return { horizontalDistance: Math.hypot(mounted.position.x - prevX, mounted.position.z - prevZ) };
  }

  for (const vehicle of state.vehicles) {
    if (vehicle.kind !== "ship" || vehicle.rider !== null) continue;
    const spec = specFor(vehicle.kind);
    scratchRight.set(Math.cos(vehicle.yaw), 0, Math.sin(vehicle.yaw));
    scratchForward.set(-Math.sin(vehicle.yaw), 0, -Math.cos(vehicle.yaw));
    const dx = state.player.position.x - vehicle.position.x;
    const dz = state.player.position.z - vehicle.position.z;
    const localX = dx * scratchRight.x + dz * scratchRight.z;
    const localZ = dx * scratchForward.x + dz * scratchForward.z;
    if (Math.abs(localX) <= spec.halfWidth && Math.abs(localZ) <= spec.halfLength && Math.abs(state.player.position.y - vehicle.position.y) <= 1.2) {
      mountVehicle(state, vehicle);
      break;
    }
  }
  return { horizontalDistance: 0 };
}
