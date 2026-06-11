import { BiomeId, BlockId, WORLD_SIZE_X, WORLD_SIZE_Y, WORLD_SIZE_Z } from "./blocks";

/**
 * Voxel data store plus cheap world queries. Terrain generation lives in
 * generation.ts, meshing in meshing.ts, raycast/collision in queries.ts.
 *
 * ⚠ Save-format invariants: saves address voxels through index(), and getBiome()
 * feeds terrain generation. Changing either breaks every existing save — see
 * generation.test.ts.
 */
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
}
