import * as THREE from "three";

export const WORLD_SIZE_X = 512;
export const WORLD_SIZE_Y = 100;
export const WORLD_SIZE_Z = 512;

export const enum BlockId {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Wood = 4,
  Leaves = 5,
  Bedrock = 6,
  Planks = 7,
  Cobblestone = 8,
  Sand = 9,
  Brick = 10,
  Glass = 11,
  SliverOre = 12,
  RubyOre = 13,
  GoldOre = 14,
  SapphireOre = 15,
  DiamondOre = 16,
  Water = 17
}

export enum BiomeId {
  Plains = 0,
  Desert = 1,
  Ocean = 2,
  Forest = 3,
  Mountains = 4
}

const BLOCK_COLORS: Record<number, [number, number, number]> = {
  [BlockId.Grass]: [0.35, 0.68, 0.22],
  [BlockId.Dirt]: [0.46, 0.33, 0.2],
  [BlockId.Stone]: [0.54, 0.56, 0.58],
  [BlockId.Wood]: [0.51, 0.37, 0.19],
  [BlockId.Leaves]: [0.22, 0.5, 0.2],
  [BlockId.Bedrock]: [0.14, 0.14, 0.14],
  [BlockId.Planks]: [0.76, 0.61, 0.38],
  [BlockId.Cobblestone]: [0.42, 0.43, 0.45],
  [BlockId.Sand]: [0.86, 0.8, 0.5],
  [BlockId.Brick]: [0.68, 0.28, 0.2],
  [BlockId.Glass]: [0.73, 0.9, 0.95],
  [BlockId.SliverOre]: [0.54, 0.56, 0.58],
  [BlockId.RubyOre]: [0.54, 0.56, 0.58],
  [BlockId.GoldOre]: [0.54, 0.56, 0.58],
  [BlockId.SapphireOre]: [0.54, 0.56, 0.58],
  [BlockId.DiamondOre]: [0.54, 0.56, 0.58],
  [BlockId.Water]: [0.26, 0.45, 0.78]
};

const ATLAS_TILE_SIZE = 16;
const ATLAS_FACE_VARIANTS = 3; // top, side, bottom
const ATLAS_COLUMNS = 16;
let atlasTextureCache: THREE.CanvasTexture | null = null;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function tone(c: [number, number, number], mul: number, add = 0): [number, number, number] {
  return [clamp01(c[0] * mul + add), clamp01(c[1] * mul + add), clamp01(c[2] * mul + add)];
}

function rgb(c: [number, number, number]): string {
  return `rgb(${Math.floor(clamp01(c[0]) * 255)}, ${Math.floor(clamp01(c[1]) * 255)}, ${Math.floor(clamp01(c[2]) * 255)})`;
}

function tileIndexFor(block: number, face: "top" | "side" | "bottom"): number {
  const faceId = face === "top" ? 0 : face === "side" ? 1 : 2;
  return block * ATLAS_FACE_VARIANTS + faceId;
}

export function createBlockAtlasTexture(): THREE.CanvasTexture {
  if (atlasTextureCache) return atlasTextureCache;

  const totalTiles = (BlockId.Water + 1) * ATLAS_FACE_VARIANTS;
  const rows = Math.ceil(totalTiles / ATLAS_COLUMNS);
  const width = ATLAS_COLUMNS * ATLAS_TILE_SIZE;
  const height = rows * ATLAS_TILE_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to create atlas context");
  ctx.imageSmoothingEnabled = false;

  const drawTile = (block: number, face: "top" | "side" | "bottom") => {
    const tile = tileIndexFor(block, face);
    const col = tile % ATLAS_COLUMNS;
    const row = Math.floor(tile / ATLAS_COLUMNS);
    const ox = col * ATLAS_TILE_SIZE;
    const oy = row * ATLAS_TILE_SIZE;

    const baseBlockColor = BLOCK_COLORS[block] ?? [1, 0, 1];
    let base = baseBlockColor;
    if (face === "top") base = tone(base, 1.08);
    if (face === "bottom") base = tone(base, 0.96);
    if (block === BlockId.Grass && face === "bottom") base = BLOCK_COLORS[BlockId.Dirt];

    for (let y = 0; y < ATLAS_TILE_SIZE; y += 1) {
      for (let x = 0; x < ATLAS_TILE_SIZE; x += 1) {
        const h = Math.sin((x + block * 13 + (face === "top" ? 7 : face === "side" ? 17 : 29)) * 12.1 + (y + block * 19) * 7.7) * 43758.5453;
        const n = h - Math.floor(h);
        let c = tone(base, 0.92 + n * 0.22);

        if (block === BlockId.Grass && face === "side" && y < 4) c = tone(BLOCK_COLORS[BlockId.Grass], 0.95 + n * 0.15);
        if ((block === BlockId.Stone || block === BlockId.Cobblestone || block === BlockId.Bedrock) && n > 0.8) c = tone(base, 1.18);
        if ((block === BlockId.Wood || block === BlockId.Planks) && ((x + y) % 4 === 0)) c = tone(base, 0.82);
        if (block === BlockId.SliverOre && n > 0.86) c = tone([0.93, 0.93, 0.95], 1);
        if (block === BlockId.RubyOre && n > 0.88) c = tone([0.86, 0.24, 0.24], 1);
        if (block === BlockId.GoldOre && n > 0.84) c = tone([0.96, 0.8, 0.25], 1);
        if (block === BlockId.SapphireOre && n > 0.86) c = tone([0.2, 0.62, 0.9], 1);
        if (block === BlockId.DiamondOre && n > 0.9) c = tone([0.7, 0.94, 0.98], 1);
        if (block === BlockId.Water) c = tone([0.22, 0.48, 0.85], 0.95 + n * 0.12, face === "top" ? 0.02 : 0);
        if (block === BlockId.Sand && n > 0.84) c = tone(base, 1.12);

        ctx.fillStyle = rgb(c);
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  };

  for (let block = BlockId.Grass; block <= BlockId.Water; block += 1) {
    drawTile(block, "top");
    drawTile(block, "side");
    drawTile(block, "bottom");
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipMapNearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.needsUpdate = true;
  atlasTextureCache = texture;
  return texture;
}

const FACE_DEFS: {
  dir: [number, number, number];
  corners: [number, number, number][];
}[] = [
  { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { dir: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { dir: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { dir: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] }
];

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

export class VoxelWorld {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  readonly seed: number;
  readonly blocks: Uint8Array;

  constructor(sizeX = WORLD_SIZE_X, sizeY = WORLD_SIZE_Y, sizeZ = WORLD_SIZE_Z, seed = 1337) {
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.sizeZ = sizeZ;
    this.seed = seed;
    this.blocks = new Uint8Array(sizeX * sizeY * sizeZ);
  }

  index(x: number, y: number, z: number): number {
    return x + z * this.sizeX + y * this.sizeX * this.sizeZ;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sizeX && y < this.sizeY && z < this.sizeZ;
  }

  get(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return BlockId.Air;
    return this.blocks[this.index(x, y, z)];
  }

  set(x: number, y: number, z: number, block: BlockId): void {
    if (!this.inBounds(x, y, z)) return;
    this.blocks[this.index(x, y, z)] = block;
  }

  isSolid(x: number, y: number, z: number): boolean {
    const block = this.get(x, y, z);
    return block !== BlockId.Air && block !== BlockId.Water;
  }

  highestSolidY(x: number, z: number): number {
    for (let y = this.sizeY - 1; y >= 0; y -= 1) {
      if (this.isSolid(x, y, z)) return y;
    }
    return 0;
  }

  getBiome(x: number, z: number): BiomeId {
    const s = this.seed * 0.007;
    const temp = Math.sin(x * 0.0015 + s) * 0.5 + Math.cos(z * 0.0012 + s * 1.2) * 0.5;
    const moisture = Math.sin(x * 0.0017 - s * 0.8) * 0.5 + Math.cos(z * 0.0019 + s * 1.5) * 0.5;
    const continental = Math.sin(x * 0.0007 + s * 2.1) * 0.5 + Math.cos(z * 0.0009 - s * 1.7) * 0.5;
    const ridge = Math.sin(x * 0.006 + z * 0.005 + s) * 0.5 + Math.cos(x * 0.004 - z * 0.006 - s) * 0.5;

    if (continental < -0.3) return BiomeId.Ocean;
    if (continental > 0.6 || ridge > 0.7) return BiomeId.Mountains;
    if (temp > 0.3 && moisture < -0.2) return BiomeId.Desert;
    if (moisture > 0.25) return BiomeId.Forest;
    return BiomeId.Plains;
  }

  private placeHouse(cx: number, cz: number): void {
    const half = 3;
    const floorY = this.highestSolidY(cx, cz) + 1;
    if (floorY < 3 || floorY + 6 >= this.sizeY - 1) return;

    for (let x = cx - half - 1; x <= cx + half + 1; x += 1) {
      for (let z = cz - half - 1; z <= cz + half + 1; z += 1) {
        if (!this.inBounds(x, floorY - 1, z)) return;
        const y = this.highestSolidY(x, z);
        if (Math.abs(y - (floorY - 1)) > 1) return;
      }
    }

    for (let x = cx - half; x <= cx + half; x += 1) {
      for (let z = cz - half; z <= cz + half; z += 1) this.set(x, floorY - 1, z, BlockId.Cobblestone);
    }

    for (let y = floorY; y <= floorY + 3; y += 1) {
      for (let x = cx - half; x <= cx + half; x += 1) {
        for (let z = cz - half; z <= cz + half; z += 1) {
          const wall = x === cx - half || x === cx + half || z === cz - half || z === cz + half;
          if (!wall) continue;
          const isWindow = y === floorY + 1 && ((x === cx && (z === cz - half || z === cz + half)) || (z === cz && (x === cx - half || x === cx + half)));
          this.set(x, y, z, isWindow ? BlockId.Glass : BlockId.Brick);
        }
      }
    }

    this.set(cx, floorY + 1, cz - half, BlockId.Air);
    this.set(cx, floorY + 2, cz - half, BlockId.Air);

    for (let y = floorY; y <= floorY + 3; y += 1) {
      this.set(cx - half, y, cz - half, BlockId.Wood);
      this.set(cx + half, y, cz - half, BlockId.Wood);
      this.set(cx - half, y, cz + half, BlockId.Wood);
      this.set(cx + half, y, cz + half, BlockId.Wood);
    }

    for (let x = cx - half - 1; x <= cx + half + 1; x += 1) {
      for (let z = cz - half - 1; z <= cz + half + 1; z += 1) this.set(x, floorY + 4, z, BlockId.Planks);
    }
  }

  generate(): void {
    const seededHash = (x: number, z: number): number => hash2D(x + this.seed * 0.013, z - this.seed * 0.017);
    const rand = (() => {
      let t = (this.seed >>> 0) + 0x6d2b79f5;
      return () => {
        t += 0x6d2b79f5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
      };
    })();

    this.generateTerrain(seededHash);
    this.carveCaves(rand);
    this.placeWater();
    this.placeOres(rand);
    this.placeTrees(rand, seededHash);
    this.placeStructures(rand);
  }

  private generateTerrain(seededHash: (x: number, z: number) => number): void {
    const maxX = this.sizeX - 1;
    const maxZ = this.sizeZ - 1;

    // Fast clear and bedrock
    this.blocks.fill(BlockId.Air);
    for (let x = 0; x < this.sizeX; x += 1) {
      for (let z = 0; z < this.sizeZ; z += 1) {
        this.set(x, 0, z, BlockId.Bedrock);
      }
    }

    for (let x = 0; x < this.sizeX; x += 1) {
      for (let z = 0; z < this.sizeZ; z += 1) {
        const biome = this.getBiome(x, z);
        const noise = smoothNoise2D(x, z, this.seed);

        let baseHeight = 48;
        let noiseScale = 1.0;

        if (biome === BiomeId.Plains) {
          baseHeight = 47;
          noiseScale = 2.0;
        } else if (biome === BiomeId.Desert) {
          baseHeight = 46;
          noiseScale = 3.5;
        } else if (biome === BiomeId.Ocean) {
          baseHeight = 30;
          noiseScale = 2.5;
        } else if (biome === BiomeId.Forest) {
          baseHeight = 50;
          noiseScale = 4.0;
        } else { // Mountains
          baseHeight = 55;
          noiseScale = 18.0;
        }

        const topY = Math.max(5, Math.min(this.sizeY - 5, Math.floor(baseHeight + noise * noiseScale)));
        const topBlock =
          biome === BiomeId.Desert || biome === BiomeId.Ocean ? BlockId.Sand : biome === BiomeId.Mountains && topY > 65 ? BlockId.Stone : BlockId.Grass;

        for (let y = 1; y <= topY; y += 1) {
          if (y === topY) {
            this.set(x, y, z, topBlock);
          } else if (y > topY - 3) {
            this.set(x, y, z, topBlock === BlockId.Sand ? BlockId.Sand : BlockId.Dirt);
          } else if (y > topY - 8 && hash2D(x * 0.2 + y * 0.1, z * 0.2) > 0.88) {
            this.set(x, y, z, BlockId.Cobblestone);
          } else {
            this.set(x, y, z, BlockId.Stone);
          }
        }
      }
    }

    // Unbreakable border walls.
    for (let y = 1; y <= 14; y += 1) {
      for (let x = 0; x < this.sizeX; x += 1) {
        this.set(x, y, 0, BlockId.Bedrock);
        this.set(x, y, maxZ, BlockId.Bedrock);
      }
      for (let z = 0; z < this.sizeZ; z += 1) {
        this.set(0, y, z, BlockId.Bedrock);
        this.set(maxX, y, z, BlockId.Bedrock);
      }
    }
  }

  private carveCaves(rand: () => number): void {
    const carveSphere = (cx: number, cy: number, cz: number, radius: number) => {
      const r2 = radius * radius;
      const minX = Math.max(1, Math.floor(cx - radius));
      const maxXc = Math.min(this.sizeX - 2, Math.ceil(cx + radius));
      const minY = Math.max(1, Math.floor(cy - radius));
      const maxYc = Math.min(this.sizeY - 2, Math.ceil(cy + radius));
      const minZ = Math.max(1, Math.floor(cz - radius));
      const maxZc = Math.min(this.sizeZ - 2, Math.ceil(cz + radius));
      for (let y = minY; y <= maxYc; y += 1) {
        for (let z = minZ; z <= maxZc; z += 1) {
          for (let x = minX; x <= maxXc; x += 1) {
            const dx = x - cx;
            const dy = y - cy;
            const dz = z - cz;
            if (dx * dx + dy * dy + dz * dz > r2) continue;
            const block = this.get(x, y, z);
            if (block !== BlockId.Bedrock) this.set(x, y, z, BlockId.Air);
          }
        }
      }
    };

    const caveCount = 180;
    for (let i = 0; i < caveCount; i += 1) {
      let x = 12 + rand() * (this.sizeX - 24);
      let y = 3 + rand() * (this.sizeY - 9);
      let z = 12 + rand() * (this.sizeZ - 24);
      let yaw = rand() * Math.PI * 2;
      let pitch = (rand() - 0.5) * 0.26;
      const length = 38 + Math.floor(rand() * 42);
      for (let step = 0; step < length; step += 1) {
        const r = 1.2 + rand() * 1.9;
        carveSphere(x, y, z, r);
        if (rand() > 0.982) carveSphere(x, y, z, 3.2 + rand() * 3.4);
        yaw += (rand() - 0.5) * 0.28;
        pitch = Math.max(-0.55, Math.min(0.55, pitch + (rand() - 0.5) * 0.16));
        x += Math.cos(yaw);
        z += Math.sin(yaw);
        y += Math.sin(pitch) * 0.8;
        if (x < 8 || x > this.sizeX - 8 || z < 8 || z > this.sizeZ - 8 || y < 2 || y > this.sizeY - 4) break;
      }
    }

    const chamberCount = 90;
    for (let i = 0; i < chamberCount; i += 1) {
      const cx = 12 + rand() * (this.sizeX - 24);
      const cy = 5 + rand() * (this.sizeY - 14);
      const cz = 12 + rand() * (this.sizeZ - 24);
      carveSphere(cx, cy, cz, 3.2 + rand() * 4.8);
    }
  }

  private placeWater(): void {
    const seaLevel = 43;
    for (let x = 1; x < this.sizeX - 1; x += 1) {
      for (let z = 1; z < this.sizeZ - 1; z += 1) {
        const topY = this.highestSolidY(x, z);
        if (topY >= seaLevel) continue;
        for (let y = topY + 1; y <= seaLevel; y += 1) {
          if (this.get(x, y, z) === BlockId.Air) this.set(x, y, z, BlockId.Water);
        }
      }
    }
  }

  private placeOres(rand: () => number): void {
    const hasNearbyAir = (x: number, y: number, z: number): boolean => {
      return (
        this.get(x + 1, y, z) === BlockId.Air ||
        this.get(x - 1, y, z) === BlockId.Air ||
        this.get(x, y + 1, z) === BlockId.Air ||
        this.get(x, y - 1, z) === BlockId.Air ||
        this.get(x, y, z + 1) === BlockId.Air ||
        this.get(x, y, z - 1) === BlockId.Air ||
        this.get(x + 1, y, z) === BlockId.Water ||
        this.get(x - 1, y, z) === BlockId.Water ||
        this.get(x, y + 1, z) === BlockId.Water ||
        this.get(x, y - 1, z) === BlockId.Water ||
        this.get(x, y, z + 1) === BlockId.Water ||
        this.get(x, y, z - 1) === BlockId.Water
      );
    };

    const placeOreVein = (x: number, y: number, z: number, ore: BlockId, minSize: number, maxSize: number) => {
      const size = minSize + Math.floor(rand() * Math.max(1, maxSize - minSize + 1));
      for (let i = 0; i < size; i += 1) {
        const vx = x + Math.floor((rand() - 0.5) * 4);
        const vy = y + Math.floor((rand() - 0.5) * 3);
        const vz = z + Math.floor((rand() - 0.5) * 4);
        if (!this.inBounds(vx, vy, vz) || vy <= 1) continue;
        const b = this.get(vx, vy, vz);
        if (b === BlockId.Stone || b === BlockId.Cobblestone) this.set(vx, vy, vz, ore);
      }
    };

    const oreConfigs = [
      { id: BlockId.SliverOre, attempts: 120000, minY: 3, maxYOffset: 10, minSize: 3, maxSize: 10 },
      { id: BlockId.RubyOre, attempts: 52000, minY: 2, maxYOffset: 16, minSize: 3, maxSize: 10 },
      { id: BlockId.GoldOre, attempts: 36000, minY: 2, maxYOffset: 22, minSize: 3, maxSize: 10 },
      { id: BlockId.SapphireOre, attempts: 28000, minY: 2, maxYOffset: 28, minSize: 2, maxSize: 7 },
      { id: BlockId.DiamondOre, attempts: 18000, minY: 2, maxYOffset: 36, minSize: 2, maxSize: 6 }
    ];

    for (const config of oreConfigs) {
      for (let i = 0; i < config.attempts; i += 1) {
        const x = 8 + Math.floor(rand() * (this.sizeX - 16));
        const y = config.minY + Math.floor(rand() * Math.max(2, this.sizeY - config.maxYOffset));
        const z = 8 + Math.floor(rand() * (this.sizeZ - 16));
        const block = this.get(x, y, z);
        if ((block !== BlockId.Stone && block !== BlockId.Cobblestone) || !hasNearbyAir(x, y, z)) continue;
        placeOreVein(x, y, z, config.id, config.minSize, config.maxSize);
      }
    }
  }

  private placeTrees(rand: () => number, seededHash: (x: number, z: number) => number): void {
    const treeAttempts = 5200;
    for (let i = 0; i < treeAttempts; i += 1) {
      const x = 4 + Math.floor(rand() * (this.sizeX - 8));
      const z = 4 + Math.floor(rand() * (this.sizeZ - 8));

      const biome = this.getBiome(x, z);

      let spawnChance = 0.18; // Plains
      if (biome === BiomeId.Ocean) spawnChance = 0; // Ocean
      else if (biome === BiomeId.Mountains) spawnChance = 0.05; // Mountains
      else if (biome === BiomeId.Desert) spawnChance = 0.01; // Desert
      else if (biome === BiomeId.Forest) spawnChance = 0.45; // Forest

      if (rand() > spawnChance) continue;

      const topY = this.highestSolidY(x, z);
      if (this.get(x, topY, z) !== BlockId.Grass) continue;

      const trunkHeight = spawnChance > 0.5 ? 4 + Math.floor(rand() * 3) : 3 + Math.floor(rand() * 3);
      for (let y = 1; y <= trunkHeight; y += 1) this.set(x, topY + y, z, BlockId.Wood);

      const leafStart = topY + trunkHeight - 1;
      for (let ox = -2; ox <= 2; ox += 1) {
        for (let oz = -2; oz <= 2; oz += 1) {
          for (let oy = 0; oy <= 2; oy += 1) {
            const d = Math.abs(ox) + Math.abs(oz) + oy;
            if (d > 4) continue;
            this.set(x + ox, leafStart + oy, z + oz, BlockId.Leaves);
          }
        }
      }
    }
  }

  private placeStructures(rand: () => number): void {
    for (let i = 0; i < 120; i += 1) {
      const cx = 12 + Math.floor(rand() * (this.sizeX - 24));
      const cz = 12 + Math.floor(rand() * (this.sizeZ - 24));
      this.placeHouse(cx, cz);
    }
  }

  buildGeometryRegion(minX: number, maxX: number, minZ: number, maxZ: number, minY = 0, maxY = this.sizeY - 1): THREE.BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const uvs: number[] = [];

    const clampedMinX = Math.max(0, minX);
    const clampedMaxX = Math.min(this.sizeX - 1, maxX);
    const clampedMinZ = Math.max(0, minZ);
    const clampedMaxZ = Math.min(this.sizeZ - 1, maxZ);
    const clampedMinY = Math.max(0, minY);
    const clampedMaxY = Math.min(this.sizeY - 1, maxY);

    const pushVertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number, color: [number, number, number], u: number, v: number) => {
      positions.push(x, y, z);
      normals.push(nx, ny, nz);
      colors.push(color[0], color[1], color[2]);
      uvs.push(u, v);
    };
    const materialTint = (ny: number): [number, number, number] => {
      const shade = ny > 0 ? 1 : ny < 0 ? 0.95 : 0.9;
      return [shade, shade, shade];
    };

    const tileUV = (block: number, ny: number): [number, number, number, number] => {
      const face = ny > 0 ? "top" : ny < 0 ? "bottom" : "side";
      const tile = tileIndexFor(block, face);
      const col = tile % ATLAS_COLUMNS;
      const row = Math.floor(tile / ATLAS_COLUMNS);
      const rows = Math.ceil(((BlockId.Water + 1) * ATLAS_FACE_VARIANTS) / ATLAS_COLUMNS);
      const pad = 0.0008;
      const u0 = col / ATLAS_COLUMNS + pad;
      const v0 = row / rows + pad;
      const u1 = (col + 1) / ATLAS_COLUMNS - pad;
      const v1 = (row + 1) / rows - pad;
      return [u0, v0, u1, v1];
    };

    const faceOcclusion = (x: number, y: number, z: number, nx: number, ny: number, nz: number): number => {
      const ax = nz;
      const ay = 0;
      const az = -nx;
      const bx = 0;
      const by = 1;
      const bz = 0;

      const sx = x + nx;
      const sy = y + ny;
      const sz = z + nz;

      let occ = 0;
      if (this.isSolid(sx + ax, sy + ay, sz + az)) occ += 1;
      if (this.isSolid(sx - ax, sy - ay, sz - az)) occ += 1;
      if (this.isSolid(sx + bx, sy + by, sz + bz)) occ += 1;
      if (this.isSolid(sx - bx, sy - by, sz - bz)) occ += 1;
      return Math.max(0.8, 1 - occ * 0.06);
    };

    for (let y = clampedMinY; y <= clampedMaxY; y += 1) {
      for (let z = clampedMinZ; z <= clampedMaxZ; z += 1) {
        for (let x = clampedMinX; x <= clampedMaxX; x += 1) {
          const block = this.get(x, y, z);
          if (block === BlockId.Air) continue;
          for (const face of FACE_DEFS) {
            const nx = face.dir[0];
            const ny = face.dir[1];
            const nz = face.dir[2];
            const neighbor = this.get(x + nx, y + ny, z + nz);
            if (block === BlockId.Water) {
              if (neighbor === BlockId.Water) continue;
            } else if (this.isSolid(x + nx, y + ny, z + nz)) continue;

            const base = materialTint(ny);
            const ao = faceOcclusion(x, y, z, nx, ny, nz);
            const color: [number, number, number] = [base[0] * ao, base[1] * ao, base[2] * ao];
            const [u0, v0, u1, v1] = tileUV(block, ny);

            const a = face.corners[0];
            const b = face.corners[1];
            const c = face.corners[2];
            const d = face.corners[3];

            pushVertex(x + a[0], y + a[1], z + a[2], nx, ny, nz, color, u0, v1);
            pushVertex(x + b[0], y + b[1], z + b[2], nx, ny, nz, color, u0, v0);
            pushVertex(x + c[0], y + c[1], z + c[2], nx, ny, nz, color, u1, v0);
            pushVertex(x + a[0], y + a[1], z + a[2], nx, ny, nz, color, u0, v1);
            pushVertex(x + c[0], y + c[1], z + c[2], nx, ny, nz, color, u1, v0);
            pushVertex(x + d[0], y + d[1], z + d[2], nx, ny, nz, color, u1, v1);
          }
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeBoundingSphere();
    return geometry;
  }
}

export type RaycastResult = {
  hit: THREE.Vector3;
  previous: THREE.Vector3;
};

export function voxelRaycast(
  world: VoxelWorld,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDist = 6
): RaycastResult | null {
  const dir = direction.clone().normalize();
  const pos = origin.clone();

  let x = Math.floor(pos.x);
  let y = Math.floor(pos.y);
  let z = Math.floor(pos.z);

  const stepX = dir.x > 0 ? 1 : -1;
  const stepY = dir.y > 0 ? 1 : -1;
  const stepZ = dir.z > 0 ? 1 : -1;

  const invDx = Math.abs(1 / (dir.x || 1e-6));
  const invDy = Math.abs(1 / (dir.y || 1e-6));
  const invDz = Math.abs(1 / (dir.z || 1e-6));

  let tMaxX = ((stepX > 0 ? x + 1 : x) - pos.x) / (dir.x || 1e-6);
  let tMaxY = ((stepY > 0 ? y + 1 : y) - pos.y) / (dir.y || 1e-6);
  let tMaxZ = ((stepZ > 0 ? z + 1 : z) - pos.z) / (dir.z || 1e-6);
  if (tMaxX < 0) tMaxX += invDx;
  if (tMaxY < 0) tMaxY += invDy;
  if (tMaxZ < 0) tMaxZ += invDz;

  let t = 0;
  let previous = new THREE.Vector3(x, y, z);

  while (t <= maxDist) {
    if (world.isSolid(x, y, z)) return { hit: new THREE.Vector3(x, y, z), previous };
    previous = new THREE.Vector3(x, y, z);

    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        x += stepX;
        t = tMaxX;
        tMaxX += invDx;
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += invDz;
      }
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += invDy;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += invDz;
    }
  }

  return null;
}

export function collidesAt(world: VoxelWorld, position: THREE.Vector3, halfWidth: number, height: number): boolean {
  const eps = 0.001;
  const minX = Math.floor(position.x - halfWidth + eps);
  const maxX = Math.floor(position.x + halfWidth - eps);
  const minZ = Math.floor(position.z - halfWidth + eps);
  const maxZ = Math.floor(position.z + halfWidth - eps);
  const minY = Math.floor(position.y + eps);
  const maxY = Math.floor(position.y + height - eps);

  for (let y = minY; y <= maxY; y += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (world.isSolid(x, y, z)) return true;
      }
    }
  }

  return false;
}

export function hasSupportUnderPlayer(world: VoxelWorld, position: THREE.Vector3, halfWidth: number): boolean {
  const minX = Math.floor(position.x - halfWidth);
  const maxX = Math.floor(position.x + halfWidth);
  const minZ = Math.floor(position.z - halfWidth);
  const maxZ = Math.floor(position.z + halfWidth);
  const y = Math.floor(position.y - 0.05);

  for (let z = minZ; z <= maxZ; z += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (world.isSolid(x, y, z)) return true;
    }
  }

  return false;
}
