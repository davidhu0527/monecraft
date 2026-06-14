import { BiomeId, BlockId, WORLD_SIZE_X, WORLD_SIZE_Y, WORLD_SIZE_Z } from "./blocks";
import { isDoorBlock } from "./doors";

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
      const block = this.get(x, y, z);
      if (this.isSolid(x, y, z) && !isDoorBlock(block)) return y;
    }
    return 0;
  }

  getBiome(x: number, z: number): BiomeId {
    // Two incommensurate, direction-rotated sine octaves per field, with
    // dominant wavelengths of ~250-900 blocks: each field traverses several
    // cycles across the 512-block map, so every world gets coherent patches
    // of all five biomes (~60-150 block scale).
    const s = this.seed * 0.007;
    const temp = Math.sin(x * 0.013 + z * 0.006 + s * 1.3) * 0.6 + Math.sin(x * 0.029 - z * 0.017 + s * 2.4) * 0.4;
    const moisture = Math.sin(x * 0.007 - z * 0.012 + s * 0.8) * 0.6 + Math.sin(x * 0.019 + z * 0.023 - s * 1.6) * 0.4;
    const continental = Math.sin(x * 0.008 + z * 0.01 + s * 2.1) * 0.55 + Math.sin(x * 0.014 - z * 0.009 - s * 1.7) * 0.45;
    const ridge = Math.sin(x * 0.024 + z * 0.02 + s) * 0.5 + Math.sin(x * 0.016 - z * 0.024 - s) * 0.5;

    if (continental < -0.52) return BiomeId.Ocean;
    if ((continental > 0.5 && ridge > 0) || ridge > 0.8) return BiomeId.Mountains;
    if (temp > 0.2 && moisture < -0.12) return BiomeId.Desert;
    if (moisture > 0.18) return BiomeId.Forest;
    return BiomeId.Plains;
  }
}
