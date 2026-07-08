import { REDSTONE_BUTTON_PRESS_SECONDS, REDSTONE_TICK_SECONDS, REDSTONE_WIRE_RANGE } from "@/lib/game/config";
import {
  BlockId,
  doorBlock,
  doorState,
  isDetectorRail,
  isDoorBlock,
  isLever,
  isPartialBlock,
  isPoweredRail,
  isPressurePlate,
  isRailBlock,
  isRedstoneBlock,
  isRedstoneButton,
  isRedstoneLamp,
  isRedstoneOn,
  isRedstoneOverlay,
  isRedstoneTorch,
  isRedstoneWire,
  redstoneOff,
  redstoneOn
} from "@/lib/world";
import type { EmitGameEvent, GameState, RedstoneState } from "../state";
import { primeTnt } from "./explosion";

/**
 * Redstone-lite power simulation. Binary signal: on-state sources (lever,
 * pressed button/plate, lit redstone torch) power their six face neighbors;
 * wire carries the signal up to REDSTONE_WIRE_RANGE wire-to-wire hops (with
 * one-block slope climbing) and powers everything it touches. A redstone
 * torch is an inverter — it turns off while its support block is powered,
 * and never powers its own support, so it cannot feed itself.
 *
 * The whole pass re-derives power from the block grid at a fixed cadence
 * (REDSTONE_TICK_SECONDS) and writes only actual state changes, so a stable
 * circuit costs nothing per pass. All effects are block-id swaps through the
 * blockChanges.set chokepoint (relight + save diff + net journal for free);
 * per-cell bookkeeping self-heals, so mining, explosions, and server-applied
 * edits need zero redstone awareness. Runs server-side only in online worlds:
 * replicas early-return before world systems and receive the resulting block
 * deltas through the tick journal like any other edit.
 */

export function createRedstoneState(): RedstoneState {
  return { cells: new Set(), buttonTimers: new Map(), prevDoorPowered: new Set(), timer: 0 };
}

/**
 * Boot-time seeding: every redstone block is craft-only, hence player-placed,
 * hence present in the save's block diff — scanning it recovers the full
 * component set with no persistence of our own. Rails (plain included) are
 * tracked too: the pass owns their support-pop, detector toggling, and
 * powered-rail output.
 */
export function seedRedstoneCells(state: GameState): void {
  for (const [index, block] of state.blockChanges.changes()) {
    if (isRedstoneBlock(block) || isRailBlock(block)) state.redstone.cells.add(index);
  }
}

/** The placement seam: track a freshly placed component (any redstone id). */
export function trackRedstoneCell(state: GameState, x: number, y: number, z: number): void {
  state.redstone.cells.add(state.world.index(x, y, z));
}

/** Right-click on a lever: flip it and let the next pass propagate. */
export function toggleLever(state: GameState, emit: EmitGameEvent, x: number, y: number, z: number): boolean {
  const block = state.world.get(x, y, z);
  if (!isLever(block)) return false;
  const next = isRedstoneOn(block) ? redstoneOff(block as BlockId) : redstoneOn(block as BlockId);
  state.blockChanges.set(x, y, z, next);
  state.redstone.cells.add(state.world.index(x, y, z));
  state.worldMeshDirty = true;
  emit({ type: "leverToggled", on: isRedstoneOn(next) });
  return true;
}

/** Right-click on a button: press it and arm the pop-back timer. */
export function pressButton(state: GameState, emit: EmitGameEvent, x: number, y: number, z: number): boolean {
  const block = state.world.get(x, y, z);
  if (!isRedstoneButton(block)) return false;
  // Already pressed: consume the click (re-pressing does not extend the timer).
  if (isRedstoneOn(block)) return true;
  state.blockChanges.set(x, y, z, redstoneOn(block as BlockId));
  const index = state.world.index(x, y, z);
  state.redstone.cells.add(index);
  state.redstone.buttonTimers.set(index, REDSTONE_BUTTON_PRESS_SECONDS);
  state.worldMeshDirty = true;
  emit({ type: "buttonPressed" });
  return true;
}

/** Feet cells currently standing on the ground — players, mobs, and minecarts all press. */
function collectOccupiedCells(state: GameState): Set<number> {
  const occupied = new Set<number>();
  const { world } = state;
  for (const player of state.players.values()) {
    const x = Math.floor(player.position.x);
    const y = Math.floor(player.position.y + 0.05);
    const z = Math.floor(player.position.z);
    if (world.inBounds(x, y, z)) occupied.add(world.index(x, y, z));
  }
  for (const mob of state.mobs) {
    // MobState.position is the body center; halfHeight brings us to the feet.
    const x = Math.floor(mob.position.x);
    const y = Math.floor(mob.position.y - mob.halfHeight + 0.05);
    const z = Math.floor(mob.position.z);
    if (world.inBounds(x, y, z)) occupied.add(world.index(x, y, z));
  }
  for (const vehicle of state.vehicles) {
    // A cart rides RIDE_HEIGHT above its rail cell — the -0.05 lands us on it.
    // This is what a detector rail reads, and it lets a cart hold a plate down.
    if (vehicle.kind !== "minecart") continue;
    const x = Math.floor(vehicle.position.x);
    const y = Math.floor(vehicle.position.y - 0.05);
    const z = Math.floor(vehicle.position.z);
    if (world.inBounds(x, y, z)) occupied.add(world.index(x, y, z));
  }
  return occupied;
}

const HORIZONTAL: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];

const FACES: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
];

export function tickRedstone(state: GameState, dt: number, emit: EmitGameEvent): void {
  const rs = state.redstone;
  rs.timer += dt;
  if (rs.timer < REDSTONE_TICK_SECONDS) return;
  rs.timer = 0;

  const { world } = state;
  const sizeXZ = world.sizeX * world.sizeZ;
  const xOf = (index: number) => index % world.sizeX;
  const zOf = (index: number) => Math.floor(index / world.sizeX) % world.sizeZ;
  const yOf = (index: number) => Math.floor(index / sizeXZ);
  let changed = false;
  const write = (x: number, y: number, z: number, block: BlockId) => {
    state.blockChanges.set(x, y, z, block);
    changed = true;
  };

  // Phase 1 — inputs & self-heal. Deleting while iterating a Set is safe.
  const occupied = collectOccupiedCells(state);
  for (const index of rs.cells) {
    const block = world.blocks[index];
    if (!isRedstoneBlock(block) && !isRailBlock(block)) {
      // Mined, exploded, or overwritten (locally or by a server delta): forget it.
      rs.cells.delete(index);
      rs.buttonTimers.delete(index);
      continue;
    }
    const x = xOf(index);
    const y = yOf(index);
    const z = zOf(index);
    // An overlay (or rail) whose support vanished pops off (no drop — whatever
    // removed the support, e.g. an explosion, would have vaporized the
    // component too; direct mining cascades the drop in mining.ts before this).
    if (isRedstoneOverlay(block) || isRailBlock(block)) {
      const support = world.get(x, y - 1, z);
      if (!world.isSolid(x, y - 1, z) || isRedstoneOverlay(support) || isDoorBlock(support) || isRailBlock(support) || isPartialBlock(support)) {
        write(x, y, z, BlockId.Air);
        rs.cells.delete(index);
        rs.buttonTimers.delete(index);
        continue;
      }
    }
    if (isPressurePlate(block)) {
      const pressed = occupied.has(index);
      if (pressed !== isRedstoneOn(block)) {
        write(x, y, z, pressed ? redstoneOn(block as BlockId) : redstoneOff(block as BlockId));
        emit({ type: "plateToggled", on: pressed });
      }
    }
    if (isDetectorRail(block)) {
      // The plate pattern on rails: pressed while a minecart sits on the cell.
      const pressed = occupied.has(index);
      if (pressed !== isRedstoneOn(block)) {
        write(x, y, z, pressed ? redstoneOn(block as BlockId) : redstoneOff(block as BlockId));
        emit({ type: "detectorToggled", on: pressed });
      }
    }
    if (block === BlockId.RedstoneButtonOn) {
      // A missing timer entry (a save written mid-press just reloaded) heals
      // by popping the button back immediately. The epsilon absorbs float
      // drift so the pop lands on the expected pass, not one late.
      const left = rs.buttonTimers.get(index);
      if (left === undefined || left - REDSTONE_TICK_SECONDS <= 1e-9) {
        write(x, y, z, BlockId.RedstoneButton);
        rs.buttonTimers.delete(index);
      } else {
        rs.buttonTimers.set(index, left - REDSTONE_TICK_SECONDS);
      }
    }
  }

  // Phase 2 — the power graph, re-derived from the current grid. Sources power
  // their six neighbors (a torch skips its own support — the inverter rule);
  // wire relaxes outward with a hop budget, powering everything it touches.
  const powered = new Set<number>();
  const wireBudget = new Map<number, number>();
  const queue: number[] = []; // indices with a pending budget in wireBudget
  const relax = (x: number, y: number, z: number, budget: number) => {
    if (!world.inBounds(x, y, z)) return;
    const index = world.index(x, y, z);
    if ((wireBudget.get(index) ?? 0) >= budget) return;
    wireBudget.set(index, budget);
    queue.push(index);
  };

  for (const index of rs.cells) {
    const block = world.blocks[index];
    const isSource =
      block === BlockId.LeverOn ||
      block === BlockId.RedstoneButtonOn ||
      block === BlockId.PressurePlateOn ||
      block === BlockId.RedstoneTorch ||
      block === BlockId.DetectorRailOn;
    if (!isSource) continue;
    const x = xOf(index);
    const y = yOf(index);
    const z = zOf(index);
    const skipSupport = block === BlockId.RedstoneTorch;
    for (const [fx, fy, fz] of FACES) {
      if (skipSupport && fy === -1) continue;
      const nx = x + fx;
      const ny = y + fy;
      const nz = z + fz;
      if (!world.inBounds(nx, ny, nz)) continue;
      powered.add(world.index(nx, ny, nz));
      if (isRedstoneWire(world.get(nx, ny, nz))) relax(nx, ny, nz, REDSTONE_WIRE_RANGE);
    }
  }

  while (queue.length > 0) {
    const index = queue.pop()!;
    const budget = wireBudget.get(index)!;
    const x = xOf(index);
    const y = yOf(index);
    const z = zOf(index);
    powered.add(index);
    for (const [fx, fy, fz] of FACES) {
      if (world.inBounds(x + fx, y + fy, z + fz)) powered.add(world.index(x + fx, y + fy, z + fz));
    }
    if (budget <= 1) continue;
    // Wire steps to its four horizontal neighbors at the same level and one
    // block up or down (slope climbing).
    for (const [hx, hz] of HORIZONTAL) {
      for (const dy of [0, 1, -1]) {
        const nx = x + hx;
        const ny = y + dy;
        const nz = z + hz;
        if (world.inBounds(nx, ny, nz) && isRedstoneWire(world.get(nx, ny, nz))) relax(nx, ny, nz, budget - 1);
      }
    }
  }

  // Phase 3 — outputs, written only on change.
  for (const index of rs.cells) {
    const block = world.blocks[index];
    const x = xOf(index);
    const y = yOf(index);
    const z = zOf(index);
    if (isRedstoneWire(block)) {
      const on = wireBudget.has(index);
      if (on !== isRedstoneOn(block)) write(x, y, z, on ? redstoneOn(block as BlockId) : redstoneOff(block as BlockId));
    } else if (isRedstoneLamp(block)) {
      const on = powered.has(index);
      if (on !== isRedstoneOn(block)) {
        write(x, y, z, on ? redstoneOn(block as BlockId) : redstoneOff(block as BlockId));
        emit({ type: "lampToggled", on });
      }
    } else if (isPoweredRail(block)) {
      // The lamp pattern: a level-triggered output. Silent — the cart's boost
      // (or hard stop) is the feedback; vehicles.ts reads the lit id directly.
      const on = powered.has(index);
      if (on !== isRedstoneOn(block)) write(x, y, z, on ? redstoneOn(block as BlockId) : redstoneOff(block as BlockId));
    } else if (isRedstoneTorch(block)) {
      // The inverter: off while the support block is powered. Computed from
      // this pass's grid, applied next write — a synchronous clocked update,
      // which is what makes a two-torch clock oscillate instead of flicker.
      const supportPowered = y > 0 && powered.has(world.index(x, y - 1, z));
      const shouldBeOn = !supportPowered;
      if (shouldBeOn !== isRedstoneOn(block)) write(x, y, z, shouldBeOn ? redstoneOn(block as BlockId) : redstoneOff(block as BlockId));
    }
  }

  // Consumers outside the tracked set, discovered through the powered cells:
  // doors force open/closed on power edges (manual toggling works between
  // edges), and powered TNT lights its fuse (primeTnt is idempotent).
  const doorPowered = new Set<number>();
  for (const index of powered) {
    const block = world.blocks[index];
    if (block === BlockId.Tnt) {
      primeTnt(state, xOf(index), yOf(index), zOf(index), emit);
    } else if (isDoorBlock(block)) {
      const door = doorState(block)!;
      const lowerY = door.upper ? yOf(index) - 1 : yOf(index);
      if (lowerY >= 0) doorPowered.add(world.index(xOf(index), lowerY, zOf(index)));
    }
  }
  const forceDoor = (lowerIndex: number, open: boolean) => {
    const x = xOf(lowerIndex);
    const y = yOf(lowerIndex);
    const z = zOf(lowerIndex);
    const lower = doorState(world.get(x, y, z));
    const upper = doorState(world.get(x, y + 1, z));
    if (!lower || lower.upper || !upper?.upper || lower.facing !== upper.facing) return;
    if (lower.open === open) return;
    write(x, y, z, doorBlock(lower.facing, open, false));
    write(x, y + 1, z, doorBlock(lower.facing, open, true));
    emit({ type: "doorToggled", open });
  };
  for (const lowerIndex of doorPowered) {
    if (!rs.prevDoorPowered.has(lowerIndex)) forceDoor(lowerIndex, true); // rising edge
  }
  for (const lowerIndex of rs.prevDoorPowered) {
    if (!doorPowered.has(lowerIndex) && isDoorBlock(world.blocks[lowerIndex])) forceDoor(lowerIndex, false); // falling edge
  }
  rs.prevDoorPowered = doorPowered;

  if (changed) state.worldMeshDirty = true;
}
