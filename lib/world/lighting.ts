import { BlockId } from "./blocks";
import { VoxelWorld } from "./voxelWorld";

/**
 * Per-voxel light. Two 0..15 channels packed into one byte per voxel:
 *
 *   light[idx] = (skyLight << 4) | blockLight
 *
 * - **Sky light** falls straight down from the open sky at full strength and
 *   bleeds sideways into shadow, so caves are dark and the surface is lit. The
 *   renderer modulates it by the day/night factor at draw time (the scene sun +
 *   hemisphere), so the same baked value dims at night without re-meshing.
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

// Neighbor offsets; index 3 ([0,-1,0]) is straight down, used for the sunlight
// rule (sky light falls down a clear column at full strength).
const NEIGHBORS: readonly [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
];
const DOWN = 3;

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
    case BlockId.Torch:
      return 14;
    case BlockId.Lava:
      return MAX_LIGHT;
    default:
      return 0;
  }
}

/**
 * Light level reaching a (non-blocking) neighbor from a source at `level`.
 * Sky light falling straight DOWN costs only the neighbor's opacity (sunlight is
 * free vertically at any level, matching the bake's column pass); every other
 * direction, and all block light, also pays the 1-per-step spread cost.
 */
function propagated(level: number, down: boolean, nb: BlockId, sky: boolean): number {
  return sky && down ? level - opacity(nb) : level - 1 - opacity(nb);
}

export function skyLightAt(light: Uint8Array, idx: number): number {
  return light[idx] >> SKY_SHIFT;
}

export function blockLightAt(light: Uint8Array, idx: number): number {
  return light[idx] & BLOCK_MASK;
}

function getChannel(light: Uint8Array, idx: number, sky: boolean): number {
  return sky ? light[idx] >> SKY_SHIFT : light[idx] & BLOCK_MASK;
}

function setChannel(light: Uint8Array, idx: number, value: number, sky: boolean): void {
  light[idx] = sky ? (value << SKY_SHIFT) | (light[idx] & BLOCK_MASK) : (light[idx] & SKY_MASK) | value;
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
 * Patch both light channels after a single block edit. world.blocks must already
 * reflect the edit. Uses the standard remove-then-refill flood, which visits
 * only the cells the edit actually changed — cheap for a normal edit, and
 * bounded by the shaft depth when a column is capped or opened.
 */
export function applyEdit(world: VoxelWorld, light: Uint8Array, x: number, y: number, z: number): void {
  if (!world.inBounds(x, y, z)) return;
  const idx = world.index(x, y, z);
  const block = world.blocks[idx] as BlockId;

  // Block light: drop the cell, remove what it had lit, then refill from any
  // surviving sources plus the new block's own emission.
  const oldBlock = light[idx] & BLOCK_MASK;
  setChannel(light, idx, 0, false);
  const blockRefill = removeChannel(world, light, idx, oldBlock, false);
  const emit = emission(block);
  if (emit > 0) {
    setChannel(light, idx, emit, false);
    blockRefill.push(idx);
  }
  flood(world, light, blockRefill, false);

  // Sky light: same dance. The removal honors the sunlight rule, so capping a
  // clear column cascades the shadow straight down it.
  const oldSky = light[idx] >> SKY_SHIFT;
  setChannel(light, idx, 0, true);
  const skyRefill = removeChannel(world, light, idx, oldSky, true);
  // The open sky above the world is an implicit sunlight source the in-bounds
  // remove/refill can't discover. When the edited cell is in the top layer and
  // now transmits, reseed its direct sunlight (matching the bake's column pass)
  // so reopening a ceiling block re-floods the column instead of underlighting.
  if (y === world.sizeY - 1 && !isLightBlocker(block)) {
    const seed = MAX_LIGHT - opacity(block);
    if (seed > skyLightAt(light, idx)) {
      setChannel(light, idx, seed, true);
      skyRefill.push(idx);
    }
  }
  flood(world, light, skyRefill, true);
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
    if (canLightNeighbor(world, light, x, y, z, cl, true)) queue.push(idx);
  }
  flood(world, light, queue, true);
}

function bakeBlockLight(world: VoxelWorld, light: Uint8Array): void {
  const queue: number[] = [];
  for (let idx = 0; idx < world.blocks.length; idx += 1) {
    const emit = emission(world.blocks[idx] as BlockId);
    if (emit > 0) {
      setChannel(light, idx, emit, false);
      queue.push(idx);
    }
  }
  flood(world, light, queue, false);
}

function canLightNeighbor(world: VoxelWorld, light: Uint8Array, x: number, y: number, z: number, level: number, sky: boolean): boolean {
  for (let d = 0; d < NEIGHBORS.length; d += 1) {
    const nx = x + NEIGHBORS[d][0];
    const ny = y + NEIGHBORS[d][1];
    const nz = z + NEIGHBORS[d][2];
    if (!world.inBounds(nx, ny, nz)) continue;
    const nidx = world.index(nx, ny, nz);
    const nb = world.blocks[nidx] as BlockId;
    if (isLightBlocker(nb)) continue;
    const target = propagated(level, d === DOWN, nb, sky);
    if (target > getChannel(light, nidx, sky)) return true;
  }
  return false;
}

/**
 * Remove the light a cell used to cast, starting from (sx,sy,sz) which has
 * already been zeroed in `light`. Returns the indices of surviving independent
 * sources (and adjacent emitters) to refill from. The sky channel honors the
 * sunlight rule: a downward neighbor still at full strength was lit by the
 * column above, so it is torn down too.
 */
function removeChannel(world: VoxelWorld, light: Uint8Array, startIdx: number, startLevel: number, sky: boolean): number[] {
  const { sizeX, sizeZ } = world;
  const layer = sizeX * sizeZ;
  const refill: number[] = [];
  const idxQueue: number[] = [startIdx];
  const levelQueue: number[] = [startLevel];
  let head = 0;
  while (head < idxQueue.length) {
    const idx = idxQueue[head];
    const level = levelQueue[head];
    head += 1;
    const y = Math.floor(idx / layer);
    const rem = idx - y * layer;
    const z = Math.floor(rem / sizeX);
    const x = rem - z * sizeX;
    for (let d = 0; d < NEIGHBORS.length; d += 1) {
      const nx = x + NEIGHBORS[d][0];
      const ny = y + NEIGHBORS[d][1];
      const nz = z + NEIGHBORS[d][2];
      if (!world.inBounds(nx, ny, nz)) continue;
      const nidx = world.index(nx, ny, nz);
      const nb = world.blocks[nidx] as BlockId;
      if (isLightBlocker(nb)) {
        // A blocker holds no flooded light, but a lit emitter (lava) is a fixed
        // source the refill must spread from.
        if (!sky && emission(nb) > 0) refill.push(nidx);
        continue;
      }
      const nl = getChannel(light, nidx, sky);
      // What this cell, at `level`, would have given the neighbor. If the
      // neighbor is no brighter than that, it was lit by us — tear it down and
      // cascade; otherwise it has an independent source the refill spreads from.
      const wouldGive = propagated(level, d === DOWN, nb, sky);
      if (nl !== 0 && nl <= wouldGive) {
        setChannel(light, nidx, 0, sky);
        idxQueue.push(nidx);
        levelQueue.push(nl);
      } else if (nl > wouldGive && nl > 0) {
        refill.push(nidx);
      }
    }
  }
  return refill;
}

/**
 * Breadth-first light spread shared by both channels and by the bake and the
 * incremental refill. Uses a head pointer rather than Array.shift for O(1)
 * dequeue on large frontiers. For the sky channel, light at full strength
 * propagating straight down stays at full strength (sunlight).
 */
function flood(world: VoxelWorld, light: Uint8Array, queue: number[], sky: boolean): void {
  const { sizeX, sizeZ } = world;
  const layer = sizeX * sizeZ;
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head];
    head += 1;
    const cl = getChannel(light, idx, sky);
    if (cl <= 1) continue;
    const y = Math.floor(idx / layer);
    const rem = idx - y * layer;
    const z = Math.floor(rem / sizeX);
    const x = rem - z * sizeX;
    for (let d = 0; d < NEIGHBORS.length; d += 1) {
      const nx = x + NEIGHBORS[d][0];
      const ny = y + NEIGHBORS[d][1];
      const nz = z + NEIGHBORS[d][2];
      if (!world.inBounds(nx, ny, nz)) continue;
      const nidx = world.index(nx, ny, nz);
      const nb = world.blocks[nidx] as BlockId;
      if (isLightBlocker(nb)) continue;
      const target = propagated(cl, d === DOWN, nb, sky);
      if (target > getChannel(light, nidx, sky)) {
        setChannel(light, nidx, target, sky);
        queue.push(nidx);
      }
    }
  }
}
