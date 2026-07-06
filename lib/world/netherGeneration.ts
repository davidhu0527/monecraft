import { BlockId } from "./blocks";
import { hashU32, portableCos, portableSin } from "./noise";
import type { VoxelWorld } from "./voxelWorld";

/**
 * The nether generator: a solid netherrack mass sealed by bedrock at y=0 AND
 * the top row (the ceiling cap is what zeroes baked skylight, giving the
 * dimension its dark), hollowed by worm-carved tunnels and broad sea chambers,
 * flooded with lava up to `lavaSeaLevel`, hung with glowstone, and seeded with
 * deep blazite ore.
 *
 * Deterministic contracts (mirrors generation.ts):
 * - Byte-identical output per (seed, size) forever — pinned by SHA-256
 *   baselines in netherGeneration.test.ts. Fix code, never hashes; a
 *   deliberate change bumps WORLDGEN_VERSION (one stamp governs BOTH
 *   dimensions' diffs — see docs/save-format.md).
 * - All noise/trig from lib/world/noise.ts portables (Bun ≡ browser).
 * - Own mulberry32 streams xor'd with fresh constants (0x94d049bb caverns,
 *   0x3c6ef372 ore) so future passes can't shift each other. The overworld's
 *   constants (0x85ebca6b, 0x9e3779b9, 0xc2b2ae35, 0x27d4eb2f) are avoided on
 *   principle even though the streams never mix.
 * - Attempt counts scale by AREA (unlike GEN's fixed counts) because the
 *   engine's headless tests boot tiny nether worlds — fixed counts tuned for
 *   512² would hollow a 64² world into one open void.
 */
export const NETHER_GEN = Object.freeze({
  // Carved air at/below this height floods with lava — the seas.
  lavaSeaLevel: 32,
  // Worm tunnels per 512×512 of area.
  wormCount: 120,
  // Broad, flat sea chambers per 512×512 — carved low so the lava fills them.
  seaChamberCount: 26,
  // Glowstone ceiling-cluster gate, applied per eligible ceiling cell.
  glowstoneChance: 0.045,
  // Blazite veins per 512×512, confined to the deep mass.
  blaziteVeinCount: 150,
  blaziteMaxY: 40
});

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Attempt count for this world's area, tuned against the 512×512 baseline. */
function scaledByArea(count: number, world: VoxelWorld): number {
  return Math.max(4, Math.round((count * (world.sizeX * world.sizeZ)) / (512 * 512)));
}

export function generateNetherWorld(world: VoxelWorld): void {
  fillNetherMass(world);
  carveNetherCaverns(world, mulberry32((world.seed >>> 0) ^ 0x94d049bb));
  floodLavaSea(world);
  placeGlowstoneClusters(world);
  placeBlaziteOre(world, mulberry32((world.seed >>> 0) ^ 0x3c6ef372));
  sealBedrockCaps(world);
}

/** Solid netherrack between the bedrock caps — the caverns are carved out of it. */
function fillNetherMass(world: VoxelWorld): void {
  for (let x = 0; x < world.sizeX; x += 1) {
    for (let z = 0; z < world.sizeZ; z += 1) {
      world.set(x, 0, z, BlockId.Bedrock);
      for (let y = 1; y < world.sizeY - 1; y += 1) world.set(x, y, z, BlockId.Netherrack);
      world.set(x, world.sizeY - 1, z, BlockId.Bedrock);
    }
  }
}

/** Carves a sphere of air, sparing bedrock (shared by worms and chambers). */
function carveSphere(world: VoxelWorld, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): void {
  const minX = Math.max(1, Math.floor(cx - rx));
  const maxX = Math.min(world.sizeX - 2, Math.ceil(cx + rx));
  const minY = Math.max(2, Math.floor(cy - ry));
  const maxY = Math.min(world.sizeY - 3, Math.ceil(cy + ry));
  const minZ = Math.max(1, Math.floor(cz - rz));
  const maxZ = Math.min(world.sizeZ - 2, Math.ceil(cz + rz));
  for (let y = minY; y <= maxY; y += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const dz = (z - cz) / rz;
        if (dx * dx + dy * dy + dz * dz > 1) continue;
        if (world.get(x, y, z) !== BlockId.Bedrock) world.set(x, y, z, BlockId.Air);
      }
    }
  }
}

/**
 * Two carving families: winding worm tunnels (the overworld cave walk, thicker
 * and with more frequent chamber bursts) and broad flat sea chambers carved low
 * so the lava flood turns them into open seas with netherrack shores.
 */
function carveNetherCaverns(world: VoxelWorld, rand: () => number): void {
  const worms = scaledByArea(NETHER_GEN.wormCount, world);
  for (let i = 0; i < worms; i += 1) {
    let x = 8 + rand() * (world.sizeX - 16);
    let y = 8 + rand() * (world.sizeY - 26);
    let z = 8 + rand() * (world.sizeZ - 16);
    let yaw = rand() * Math.PI * 2;
    let pitch = (rand() - 0.5) * 0.3;
    const length = 50 + Math.floor(rand() * 70);
    for (let step = 0; step < length; step += 1) {
      const r = 2.4 + rand() * 3.0;
      carveSphere(world, x, y, z, r, r * 0.8, r);
      if (rand() > 0.94) {
        const burst = 6 + rand() * 6;
        carveSphere(world, x, y, z, burst, burst * 0.55, burst);
      }
      yaw += (rand() - 0.5) * 0.3;
      pitch = Math.max(-0.5, Math.min(0.5, pitch + (rand() - 0.5) * 0.18));
      x += portableCos(yaw) * 1.2;
      z += portableSin(yaw) * 1.2;
      y += portableSin(pitch);
      if (x < 6 || x > world.sizeX - 6 || z < 6 || z > world.sizeZ - 6 || y < 4 || y > world.sizeY - 12) break;
    }
  }

  const chambers = scaledByArea(NETHER_GEN.seaChamberCount, world);
  for (let i = 0; i < chambers; i += 1) {
    const cx = 14 + rand() * (world.sizeX - 28);
    const cz = 14 + rand() * (world.sizeZ - 28);
    const cy = NETHER_GEN.lavaSeaLevel - 6 + rand() * 8; // straddles the flood line
    const rx = 12 + rand() * 16;
    const rz = 12 + rand() * 16;
    const ry = 6 + rand() * 5;
    carveSphere(world, cx, cy, cz, rx, ry, rz);
  }
}

/** Carved air at/below the sea level floods with lava — the nether's seas and pools. */
function floodLavaSea(world: VoxelWorld): void {
  for (let y = 1; y <= NETHER_GEN.lavaSeaLevel; y += 1) {
    for (let z = 0; z < world.sizeZ; z += 1) {
      for (let x = 0; x < world.sizeX; x += 1) {
        if (world.get(x, y, z) === BlockId.Air) world.set(x, y, z, BlockId.Lava);
      }
    }
  }
}

/** Seeded [0,1) hash of an integer cell position — the per-cell worldgen gate. */
function cellHash01(x: number, y: number, z: number, seed: number, salt: number): number {
  return (
    hashU32((Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(z | 0, 0x85ebca6b) ^ Math.imul(y | 0, 0xc2b2ae35) ^ Math.imul((seed ^ salt) | 0, 0x27d4eb2f)) | 0) /
    4294967296
  );
}

/**
 * Hangs glowstone off cavern ceilings: an eligible cell has netherrack above
 * and open air for at least three cells below (so clusters read as hanging
 * lamps, not wall warts). Gated per cell by a seeded position hash — no shared
 * PRNG stream, so cluster placement can never shift the carving bytes.
 */
function placeGlowstoneClusters(world: VoxelWorld): void {
  for (let x = 2; x < world.sizeX - 2; x += 1) {
    for (let z = 2; z < world.sizeZ - 2; z += 1) {
      for (let y = world.sizeY - 4; y > NETHER_GEN.lavaSeaLevel + 4; y -= 1) {
        if (world.get(x, y, z) !== BlockId.Air) continue;
        if (world.get(x, y + 1, z) !== BlockId.Netherrack) continue;
        if (world.get(x, y - 1, z) !== BlockId.Air || world.get(x, y - 2, z) !== BlockId.Air) continue;
        if (cellHash01(x, y, z, world.seed, 0x51ed2701) >= NETHER_GEN.glowstoneChance) continue;
        // A small hanging blob: the anchor cell, a drip below, a side bud.
        world.set(x, y, z, BlockId.Glowstone);
        const roll = cellHash01(x, y, z, world.seed, 0x2ab7de19);
        if (roll > 0.4) world.set(x, y - 1, z, BlockId.Glowstone);
        if (roll > 0.75 && world.get(x + 1, y, z) === BlockId.Air) world.set(x + 1, y, z, BlockId.Glowstone);
      }
    }
  }
}

/** Blazite veins in the deep mass: small netherrack-replacing blobs, diamond-gated to mine. */
function placeBlaziteOre(world: VoxelWorld, rand: () => number): void {
  const veins = scaledByArea(NETHER_GEN.blaziteVeinCount, world);
  for (let i = 0; i < veins; i += 1) {
    const cx = Math.floor(4 + rand() * (world.sizeX - 8));
    const cy = Math.floor(2 + rand() * (NETHER_GEN.blaziteMaxY - 2));
    const cz = Math.floor(4 + rand() * (world.sizeZ - 8));
    const size = 2 + Math.floor(rand() * 4);
    let x = cx;
    let y = cy;
    let z = cz;
    for (let n = 0; n < size; n += 1) {
      if (world.get(x, y, z) === BlockId.Netherrack) world.set(x, y, z, BlockId.BlaziteOre);
      const axis = Math.floor(rand() * 3);
      const dir = rand() < 0.5 ? -1 : 1;
      if (axis === 0) x = Math.max(1, Math.min(world.sizeX - 2, x + dir));
      else if (axis === 1) y = Math.max(2, Math.min(NETHER_GEN.blaziteMaxY, y + dir));
      else z = Math.max(1, Math.min(world.sizeZ - 2, z + dir));
    }
  }
}

/** Defensive: the caps are load-bearing (skylight zeroing, world border). */
function sealBedrockCaps(world: VoxelWorld): void {
  for (let x = 0; x < world.sizeX; x += 1) {
    for (let z = 0; z < world.sizeZ; z += 1) {
      world.set(x, 0, z, BlockId.Bedrock);
      world.set(x, world.sizeY - 1, z, BlockId.Bedrock);
    }
  }
}
