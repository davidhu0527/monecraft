import { BlockId } from "./blocks";
import { VoxelWorld } from "./voxelWorld";

/**
 * Per-voxel light. Two 0..15 channels packed into one byte per voxel:
 *
 *   light[idx] = (skyLight << 4) | blockLight
 *
 * - **Sky light** falls straight down from the open sky at full strength and
 *   bleeds sideways into shadow, so caves are dark and the surface is lit. The
 *   renderer modulates it by the day/night factor at draw time (a uniform), so
 *   the same baked value dims at night without re-meshing.
 * - **Block light** radiates from emitters (torches, lava) and is independent of
 *   the day/night cycle — a torch lights a cave at midnight.
 *
 * The whole field is a DERIVED cache: it is recomputed from world.blocks at load
 * (computeFullLight) and patched locally on every block edit (applyEdit). It is
 * never serialized — see docs/save-format.md.
 */

export const MAX_LIGHT = 15;

// Sentinel "fully blocks light" opacity. Any value >= MAX_LIGHT stops light dead
// within the 0..15 range, so unknown/solid blocks cast a full shadow.
const OPAQUE = MAX_LIGHT;

const SKY_SHIFT = 4;
const BLOCK_MASK = 0x0f;
const SKY_MASK = 0xf0;

// Edits can only change light within MAX_LIGHT steps of the changed voxel, so a
// box of this radius (with the ring just outside it held fixed) fully contains
// every cell an edit can affect. See applyEdit.
const EDIT_RADIUS = MAX_LIGHT;

const NEIGHBORS: readonly [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
];

/**
 * Extra light absorbed when light enters this block, on top of the 1-per-step
 * cost of horizontal/diagonal spread. 0 = fully transparent (air, glass), small
 * values attenuate (water, leaves), OPAQUE fully blocks. New blocks default to
 * OPAQUE — a solid block casts shadow until classified otherwise.
 */
export function opacity(block: BlockId): number {
  switch (block) {
    case BlockId.Air:
    case BlockId.Glass:
      return 0;
    case BlockId.Leaves:
    case BlockId.Water:
      return 1;
    default:
      return OPAQUE;
  }
}

/** True if the block stops light entirely (cannot be lit, cannot transmit). */
export function isLightBlocker(block: BlockId): boolean {
  return opacity(block) >= OPAQUE;
}

/**
 * Block light a source block emits (0 = not a light source). Torch and lava are
 * added with their blocks in later commits; the default keeps every other block
 * dark.
 */
export function emission(block: BlockId): number {
  switch (block) {
    default:
      return 0;
  }
}

export function skyLightAt(light: Uint8Array, idx: number): number {
  return light[idx] >> SKY_SHIFT;
}

export function blockLightAt(light: Uint8Array, idx: number): number {
  return light[idx] & BLOCK_MASK;
}

function setSky(light: Uint8Array, idx: number, value: number): void {
  light[idx] = (value << SKY_SHIFT) | (light[idx] & BLOCK_MASK);
}

function setBlock(light: Uint8Array, idx: number, value: number): void {
  light[idx] = (light[idx] & SKY_MASK) | value;
}

/**
 * Bake both light channels for the whole world from world.blocks. Returns a
 * freshly allocated light field the caller owns (VoxelWorld holds it). One-time
 * cost at world load.
 */
export function computeFullLight(world: VoxelWorld): Uint8Array {
  const light = new Uint8Array(world.blocks.length);
  bakeSkyLight(world, light);
  bakeBlockLight(world, light);
  return light;
}

/**
 * Recompute light in a bounded box around an edited voxel. world.blocks must
 * already reflect the edit. Correctness: a single block change can only alter
 * light within MAX_LIGHT steps of it, so the ±EDIT_RADIUS box contains every
 * affected cell and the ring just outside is an unchanged, fixed light boundary
 * the flood pulls from. Bounded to ~31×31×height cells — sub-millisecond.
 */
export function applyEdit(world: VoxelWorld, light: Uint8Array, x: number, y: number, z: number): void {
  const { sizeX, sizeY, sizeZ } = world;
  const x0 = Math.max(0, x - EDIT_RADIUS);
  const x1 = Math.min(sizeX - 1, x + EDIT_RADIUS);
  const z0 = Math.max(0, z - EDIT_RADIUS);
  const z1 = Math.min(sizeZ - 1, z + EDIT_RADIUS);

  // Clear the interior (both channels) and recompute direct top-down sky light
  // per column. Full height keeps each column self-contained.
  for (let zz = z0; zz <= z1; zz += 1) {
    for (let xx = x0; xx <= x1; xx += 1) {
      let sky = MAX_LIGHT;
      for (let yy = sizeY - 1; yy >= 0; yy -= 1) {
        const idx = world.index(xx, yy, zz);
        const op = opacity(world.blocks[idx] as BlockId);
        sky = op >= OPAQUE ? 0 : Math.max(0, sky - op);
        light[idx] = sky << SKY_SHIFT; // also clears the block nibble
      }
    }
  }

  // Seed both floods from the interior plus the fixed boundary ring. The flood
  // only ever raises light, so ring cells (already correct) stay put while they
  // push their light inward; interior emitters and direct sky fill the rest.
  const skyQueue: number[] = [];
  const blockQueue: number[] = [];
  const rx0 = Math.max(0, x0 - 1);
  const rx1 = Math.min(sizeX - 1, x1 + 1);
  const rz0 = Math.max(0, z0 - 1);
  const rz1 = Math.min(sizeZ - 1, z1 + 1);
  for (let zz = rz0; zz <= rz1; zz += 1) {
    for (let xx = rx0; xx <= rx1; xx += 1) {
      const onRing = xx < x0 || xx > x1 || zz < z0 || zz > z1;
      for (let yy = 0; yy < sizeY; yy += 1) {
        const idx = world.index(xx, yy, zz);
        if (onRing) {
          // Fixed boundary: re-derive nothing, just let it push inward.
          if (skyLightAt(light, idx) > 1) skyQueue.push(idx);
          if (blockLightAt(light, idx) > 1) blockQueue.push(idx);
          continue;
        }
        const emit = emission(world.blocks[idx] as BlockId);
        if (emit > 0) {
          setBlock(light, idx, emit);
          blockQueue.push(idx);
        }
        if (skyLightAt(light, idx) > 1) skyQueue.push(idx);
      }
    }
  }
  flood(world, light, skyQueue, skyLightAt, setSky);
  flood(world, light, blockQueue, blockLightAt, setBlock);
}

function bakeSkyLight(world: VoxelWorld, light: Uint8Array): void {
  const { sizeX, sizeY, sizeZ } = world;
  const layer = sizeX * sizeZ;

  // Column pass: sunlight falls straight down for free (no per-step cost) until
  // it hits opacity, so an open column reaches the ground at full strength.
  for (let z = 0; z < sizeZ; z += 1) {
    for (let x = 0; x < sizeX; x += 1) {
      let sky = MAX_LIGHT;
      let idx = x + z * sizeX + (sizeY - 1) * layer;
      for (let y = sizeY - 1; y >= 0; y -= 1, idx -= layer) {
        const op = opacity(world.blocks[idx] as BlockId);
        sky = op >= OPAQUE ? 0 : Math.max(0, sky - op);
        light[idx] = (sky << SKY_SHIFT) | (light[idx] & BLOCK_MASK);
      }
    }
  }

  // Horizontal bleed into shadow. Seed only at brightness gradients (a lit cell
  // next to a darker reachable neighbor) so the queue stays bounded instead of
  // holding every open-air voxel.
  const queue: number[] = [];
  for (let idx = 0; idx < light.length; idx += 1) {
    const cl = light[idx] >> SKY_SHIFT;
    if (cl <= 1) continue;
    const y = Math.floor(idx / layer);
    const rem = idx - y * layer;
    const z = Math.floor(rem / sizeX);
    const x = rem - z * sizeX;
    if (canLightNeighbor(world, light, x, y, z, cl, skyLightAt)) queue.push(idx);
  }
  flood(world, light, queue, skyLightAt, setSky);
}

function bakeBlockLight(world: VoxelWorld, light: Uint8Array): void {
  const queue: number[] = [];
  for (let idx = 0; idx < world.blocks.length; idx += 1) {
    const emit = emission(world.blocks[idx] as BlockId);
    if (emit > 0) {
      setBlock(light, idx, emit);
      queue.push(idx);
    }
  }
  flood(world, light, queue, blockLightAt, setBlock);
}

function canLightNeighbor(
  world: VoxelWorld,
  light: Uint8Array,
  x: number,
  y: number,
  z: number,
  level: number,
  read: (light: Uint8Array, idx: number) => number
): boolean {
  for (const [dx, dy, dz] of NEIGHBORS) {
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    if (!world.inBounds(nx, ny, nz)) continue;
    const nidx = world.index(nx, ny, nz);
    const nb = world.blocks[nidx] as BlockId;
    if (isLightBlocker(nb)) continue;
    if (level - 1 - opacity(nb) > read(light, nidx)) return true;
  }
  return false;
}

/**
 * Breadth-first light spread shared by both channels. Reads/writes go through
 * the channel accessors so the same flood serves sky and block light. Uses a
 * head pointer rather than Array.shift for O(1) dequeue on large frontiers.
 */
function flood(
  world: VoxelWorld,
  light: Uint8Array,
  queue: number[],
  read: (light: Uint8Array, idx: number) => number,
  write: (light: Uint8Array, idx: number, value: number) => void
): void {
  const { sizeX, sizeZ } = world;
  const layer = sizeX * sizeZ;
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head];
    head += 1;
    const cl = read(light, idx);
    if (cl <= 1) continue;
    const y = Math.floor(idx / layer);
    const rem = idx - y * layer;
    const z = Math.floor(rem / sizeX);
    const x = rem - z * sizeX;
    for (const [dx, dy, dz] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (!world.inBounds(nx, ny, nz)) continue;
      const nidx = world.index(nx, ny, nz);
      const nb = world.blocks[nidx] as BlockId;
      if (isLightBlocker(nb)) continue;
      const target = cl - 1 - opacity(nb);
      if (target > read(light, nidx)) {
        write(light, nidx, target);
        queue.push(nidx);
      }
    }
  }
}
