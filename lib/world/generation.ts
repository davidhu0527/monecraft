import { BiomeId, BlockId } from "./blocks";
import { VoxelWorld } from "./voxelWorld";

/**
 * Deterministic terrain generation.
 *
 * ⚠ Saves store only the seed plus block-change deltas, so generateWorld() must
 * produce byte-identical output for a given seed forever. Generation order, the
 * PRNG, the noise functions, and every constant below are part of the save
 * format. generation.test.ts pins the output with SHA-256 digests — if it fails
 * after a change here, the change breaks existing saves.
 */

/**
 * Every value here is part of the save format (see module header). Names exist
 * for readability; changing a value re-rolls every world.
 */
export const GEN = Object.freeze({
  seaLevel: 43,
  borderWallHeight: 14,
  biomes: Object.freeze({
    [BiomeId.Plains]: Object.freeze({ baseHeight: 47, noiseScale: 2.0, treeChance: 0.18 }),
    [BiomeId.Desert]: Object.freeze({ baseHeight: 46, noiseScale: 3.5, treeChance: 0.01 }),
    [BiomeId.Ocean]: Object.freeze({ baseHeight: 30, noiseScale: 2.5, treeChance: 0 }),
    [BiomeId.Forest]: Object.freeze({ baseHeight: 50, noiseScale: 4.0, treeChance: 0.6 }),
    [BiomeId.Mountains]: Object.freeze({ baseHeight: 55, noiseScale: 18.0, treeChance: 0.05 })
  }),
  mountainStoneAboveY: 65,
  snowAboveY: 68,
  // Sand shoreline band around sea level (deeper floors keep their biome top).
  beachMaxAboveSea: 1,
  beachDepthBelowSea: 2,
  caveCount: 230,
  caveChamberCount: 150,
  treeAttempts: 9000,
  // Cacti per dry desert column — keyed on area so drowned deserts get few.
  cactusChance: 0.012,
  houseCount: 120,
  oreConfigs: Object.freeze([
    { id: BlockId.SliverOre, attempts: 120000, minY: 3, maxYOffset: 10, minSize: 3, maxSize: 10 },
    { id: BlockId.RubyOre, attempts: 52000, minY: 2, maxYOffset: 16, minSize: 3, maxSize: 10 },
    { id: BlockId.GoldOre, attempts: 36000, minY: 2, maxYOffset: 22, minSize: 3, maxSize: 10 },
    { id: BlockId.SapphireOre, attempts: 28000, minY: 2, maxYOffset: 28, minSize: 2, maxSize: 7 },
    { id: BlockId.DiamondOre, attempts: 18000, minY: 2, maxYOffset: 36, minSize: 2, maxSize: 6 }
  ])
});

function hash2D(x: number, z: number): number {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothNoise2D(x: number, z: number, seed: number): number {
  const s = seed * 0.013;
  const val =
    Math.sin(x * 0.015 + s) * 1.2 +
    Math.cos(z * 0.012 + s * 1.4) * 1.2 +
    Math.sin(x * 0.005 - z * 0.007 + s * 0.7) * 3.5 +
    Math.cos(x * 0.031 + z * 0.027 + s * 2.1) * 0.4;
  return val;
}

export function generateWorld(world: VoxelWorld): void {
  const rand = (() => {
    let t = (world.seed >>> 0) + 0x6d2b79f5;
    return () => {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  })();

  generateTerrain(world);
  carveCaves(world, rand);
  placeWater(world);
  placeBeaches(world);
  placeOres(world, rand);
  placeTrees(world, rand);
  placeCacti(world);
  placeStructures(world, rand);
}

function generateTerrain(world: VoxelWorld): void {
  const maxX = world.sizeX - 1;
  const maxZ = world.sizeZ - 1;

  // Fast clear and bedrock
  world.blocks.fill(BlockId.Air);
  for (let x = 0; x < world.sizeX; x += 1) {
    for (let z = 0; z < world.sizeZ; z += 1) {
      world.set(x, 0, z, BlockId.Bedrock);
    }
  }

  for (let x = 0; x < world.sizeX; x += 1) {
    for (let z = 0; z < world.sizeZ; z += 1) {
      const biome = world.getBiome(x, z);
      const noise = smoothNoise2D(x, z, world.seed);
      const { baseHeight, noiseScale } = GEN.biomes[biome];

      const topY = Math.max(5, Math.min(world.sizeY - 5, Math.floor(baseHeight + noise * noiseScale)));
      let topBlock = BlockId.Grass;
      if (biome === BiomeId.Desert || biome === BiomeId.Ocean) {
        topBlock = BlockId.Sand;
      } else if (biome === BiomeId.Mountains && topY > GEN.snowAboveY) {
        topBlock = BlockId.Snow;
      } else if (biome === BiomeId.Mountains && topY > GEN.mountainStoneAboveY) {
        topBlock = BlockId.Stone;
      }

      for (let y = 1; y <= topY; y += 1) {
        if (y === topY) {
          world.set(x, y, z, topBlock);
        } else if (y > topY - 3) {
          world.set(x, y, z, topBlock === BlockId.Sand ? BlockId.Sand : BlockId.Dirt);
        } else if (y > topY - 8 && hash2D(x * 0.2 + y * 0.1, z * 0.2) > 0.88) {
          world.set(x, y, z, BlockId.Cobblestone);
        } else {
          world.set(x, y, z, BlockId.Stone);
        }
      }
    }
  }

  // Unbreakable border walls.
  for (let y = 1; y <= GEN.borderWallHeight; y += 1) {
    for (let x = 0; x < world.sizeX; x += 1) {
      world.set(x, y, 0, BlockId.Bedrock);
      world.set(x, y, maxZ, BlockId.Bedrock);
    }
    for (let z = 0; z < world.sizeZ; z += 1) {
      world.set(0, y, z, BlockId.Bedrock);
      world.set(maxX, y, z, BlockId.Bedrock);
    }
  }
}

function carveCaves(world: VoxelWorld, rand: () => number): void {
  const carveSphere = (cx: number, cy: number, cz: number, radius: number) => {
    const r2 = radius * radius;
    const minX = Math.max(1, Math.floor(cx - radius));
    const maxXc = Math.min(world.sizeX - 2, Math.ceil(cx + radius));
    const minY = Math.max(1, Math.floor(cy - radius));
    const maxYc = Math.min(world.sizeY - 2, Math.ceil(cy + radius));
    const minZ = Math.max(1, Math.floor(cz - radius));
    const maxZc = Math.min(world.sizeZ - 2, Math.ceil(cz + radius));
    for (let y = minY; y <= maxYc; y += 1) {
      for (let z = minZ; z <= maxZc; z += 1) {
        for (let x = minX; x <= maxXc; x += 1) {
          const dx = x - cx;
          const dy = y - cy;
          const dz = z - cz;
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          const block = world.get(x, y, z);
          if (block !== BlockId.Bedrock) world.set(x, y, z, BlockId.Air);
        }
      }
    }
  };

  for (let i = 0; i < GEN.caveCount; i += 1) {
    let x = 12 + rand() * (world.sizeX - 24);
    let y = 3 + rand() * (world.sizeY - 9);
    let z = 12 + rand() * (world.sizeZ - 24);
    let yaw = rand() * Math.PI * 2;
    let pitch = (rand() - 0.5) * 0.26;
    const length = 56 + Math.floor(rand() * 56);
    for (let step = 0; step < length; step += 1) {
      const r = 1.9 + rand() * 2.6;
      carveSphere(x, y, z, r);
      if (rand() > 0.968) carveSphere(x, y, z, 4.8 + rand() * 4.6);
      yaw += (rand() - 0.5) * 0.28;
      pitch = Math.max(-0.55, Math.min(0.55, pitch + (rand() - 0.5) * 0.16));
      x += Math.cos(yaw);
      z += Math.sin(yaw);
      y += Math.sin(pitch) * 0.8;
      if (x < 8 || x > world.sizeX - 8 || z < 8 || z > world.sizeZ - 8 || y < 2 || y > world.sizeY - 4) break;
    }
  }

  for (let i = 0; i < GEN.caveChamberCount; i += 1) {
    const cx = 12 + rand() * (world.sizeX - 24);
    const cy = 5 + rand() * (world.sizeY - 14);
    const cz = 12 + rand() * (world.sizeZ - 24);
    carveSphere(cx, cy, cz, 5.4 + rand() * 6.4);
  }
}

function placeWater(world: VoxelWorld): void {
  const { seaLevel } = GEN;
  for (let x = 1; x < world.sizeX - 1; x += 1) {
    for (let z = 1; z < world.sizeZ - 1; z += 1) {
      const topY = world.highestSolidY(x, z);
      if (topY >= seaLevel) continue;
      for (let y = topY + 1; y <= seaLevel; y += 1) {
        if (world.get(x, y, z) === BlockId.Air) world.set(x, y, z, BlockId.Water);
      }
    }
  }
}

function placeOres(world: VoxelWorld, rand: () => number): void {
  const hasNearbyAir = (x: number, y: number, z: number): boolean => {
    return (
      world.get(x + 1, y, z) === BlockId.Air ||
      world.get(x - 1, y, z) === BlockId.Air ||
      world.get(x, y + 1, z) === BlockId.Air ||
      world.get(x, y - 1, z) === BlockId.Air ||
      world.get(x, y, z + 1) === BlockId.Air ||
      world.get(x, y, z - 1) === BlockId.Air ||
      world.get(x + 1, y, z) === BlockId.Water ||
      world.get(x - 1, y, z) === BlockId.Water ||
      world.get(x, y + 1, z) === BlockId.Water ||
      world.get(x, y - 1, z) === BlockId.Water ||
      world.get(x, y, z + 1) === BlockId.Water ||
      world.get(x, y, z - 1) === BlockId.Water
    );
  };

  const placeOreVein = (x: number, y: number, z: number, ore: BlockId, minSize: number, maxSize: number) => {
    const size = minSize + Math.floor(rand() * Math.max(1, maxSize - minSize + 1));
    for (let i = 0; i < size; i += 1) {
      const vx = x + Math.floor((rand() - 0.5) * 4);
      const vy = y + Math.floor((rand() - 0.5) * 3);
      const vz = z + Math.floor((rand() - 0.5) * 4);
      if (!world.inBounds(vx, vy, vz) || vy <= 1) continue;
      const b = world.get(vx, vy, vz);
      if (b === BlockId.Stone || b === BlockId.Cobblestone) world.set(vx, vy, vz, ore);
    }
  };

  for (const config of GEN.oreConfigs) {
    for (let i = 0; i < config.attempts; i += 1) {
      const x = 8 + Math.floor(rand() * (world.sizeX - 16));
      const y = config.minY + Math.floor(rand() * Math.max(2, world.sizeY - config.maxYOffset));
      const z = 8 + Math.floor(rand() * (world.sizeZ - 16));
      const block = world.get(x, y, z);
      if ((block !== BlockId.Stone && block !== BlockId.Cobblestone) || !hasNearbyAir(x, y, z)) continue;
      placeOreVein(x, y, z, config.id, config.minSize, config.maxSize);
    }
  }
}

/**
 * Sand shorelines: grass columns in the sea-level band turn to beach only
 * when water actually sits nearby — inland basins at sea level stay grass.
 * Runs after placeWater so adjacency can test real water blocks.
 */
function placeBeaches(world: VoxelWorld): void {
  for (let x = 1; x < world.sizeX - 1; x += 1) {
    for (let z = 1; z < world.sizeZ - 1; z += 1) {
      const topY = world.highestSolidY(x, z);
      if (topY > GEN.seaLevel + GEN.beachMaxAboveSea || topY < GEN.seaLevel - GEN.beachDepthBelowSea) continue;
      if (world.get(x, topY, z) !== BlockId.Grass) continue;

      let nearWater = false;
      for (let dx = -2; dx <= 2 && !nearWater; dx += 1) {
        for (let dz = -2; dz <= 2 && !nearWater; dz += 1) {
          if (world.get(x + dx, GEN.seaLevel, z + dz) === BlockId.Water) nearWater = true;
        }
      }
      if (!nearWater) continue;

      for (let y = Math.max(1, topY - 2); y <= topY; y += 1) world.set(x, y, z, BlockId.Sand);
    }
  }
}

function placeTrees(world: VoxelWorld, rand: () => number): void {
  for (let i = 0; i < GEN.treeAttempts; i += 1) {
    const x = 4 + Math.floor(rand() * (world.sizeX - 8));
    const z = 4 + Math.floor(rand() * (world.sizeZ - 8));

    const biome = world.getBiome(x, z);
    const spawnChance = GEN.biomes[biome].treeChance;

    if (rand() > spawnChance) continue;

    const topY = world.highestSolidY(x, z);
    if (world.get(x, topY, z) !== BlockId.Grass) continue;

    const trunkHeight = spawnChance > 0.5 ? 4 + Math.floor(rand() * 3) : 3 + Math.floor(rand() * 3);
    for (let y = 1; y <= trunkHeight; y += 1) world.set(x, topY + y, z, BlockId.Wood);

    const leafStart = topY + trunkHeight - 1;
    for (let ox = -2; ox <= 2; ox += 1) {
      for (let oz = -2; oz <= 2; oz += 1) {
        for (let oy = 0; oy <= 2; oy += 1) {
          const d = Math.abs(ox) + Math.abs(oz) + oy;
          if (d > 4) continue;
          // Only fill air: the canopy must not eat the trunk or neighbors.
          if (world.get(x + ox, leafStart + oy, z + oz) !== BlockId.Air) continue;
          world.set(x + ox, leafStart + oy, z + oz, BlockId.Leaves);
        }
      }
    }
  }
}

function placeCacti(world: VoxelWorld): void {
  // Hash-gated scan instead of random attempts: density follows the dry
  // desert area, so a mostly-flooded desert gets few cacti instead of the
  // whole budget missing. Doesn't consume the shared rand stream.
  for (let x = 4; x < world.sizeX - 4; x += 1) {
    for (let z = 4; z < world.sizeZ - 4; z += 1) {
      if (hash2D(x * 1.7 + 11.3, z * 2.3 - 7.1) > GEN.cactusChance) continue;
      if (world.getBiome(x, z) !== BiomeId.Desert) continue;

      const topY = world.highestSolidY(x, z);
      if (world.get(x, topY, z) !== BlockId.Sand) continue;
      if (world.get(x, topY + 1, z) !== BlockId.Air) continue;

      const height = 2 + (hash2D(z * 3.1, x * 1.3) > 0.5 ? 1 : 0);
      for (let y = 1; y <= height; y += 1) world.set(x, topY + y, z, BlockId.Cactus);
    }
  }
}

function placeStructures(world: VoxelWorld, rand: () => number): void {
  for (let i = 0; i < GEN.houseCount; i += 1) {
    const cx = 12 + Math.floor(rand() * (world.sizeX - 24));
    const cz = 12 + Math.floor(rand() * (world.sizeZ - 24));
    placeHouse(world, cx, cz);
  }
}

function placeHouse(world: VoxelWorld, cx: number, cz: number): void {
  const half = 3;
  const floorY = world.highestSolidY(cx, cz) + 1;
  if (floorY < 3 || floorY + 6 >= world.sizeY - 1) return;

  for (let x = cx - half - 1; x <= cx + half + 1; x += 1) {
    for (let z = cz - half - 1; z <= cz + half + 1; z += 1) {
      if (!world.inBounds(x, floorY - 1, z)) return;
      const y = world.highestSolidY(x, z);
      if (Math.abs(y - (floorY - 1)) > 1) return;
    }
  }

  for (let x = cx - half; x <= cx + half; x += 1) {
    for (let z = cz - half; z <= cz + half; z += 1) world.set(x, floorY - 1, z, BlockId.Cobblestone);
  }

  for (let y = floorY; y <= floorY + 3; y += 1) {
    for (let x = cx - half; x <= cx + half; x += 1) {
      for (let z = cz - half; z <= cz + half; z += 1) {
        const wall = x === cx - half || x === cx + half || z === cz - half || z === cz + half;
        if (!wall) continue;
        const isWindow = y === floorY + 1 && ((x === cx && (z === cz - half || z === cz + half)) || (z === cz && (x === cx - half || x === cx + half)));
        world.set(x, y, z, isWindow ? BlockId.Glass : BlockId.Brick);
      }
    }
  }

  world.set(cx, floorY + 1, cz - half, BlockId.Air);
  world.set(cx, floorY + 2, cz - half, BlockId.Air);

  for (let y = floorY; y <= floorY + 3; y += 1) {
    world.set(cx - half, y, cz - half, BlockId.Wood);
    world.set(cx + half, y, cz - half, BlockId.Wood);
    world.set(cx - half, y, cz + half, BlockId.Wood);
    world.set(cx + half, y, cz + half, BlockId.Wood);
  }

  for (let x = cx - half - 1; x <= cx + half + 1; x += 1) {
    for (let z = cz - half - 1; z <= cz + half + 1; z += 1) world.set(x, floorY + 4, z, BlockId.Planks);
  }
}
