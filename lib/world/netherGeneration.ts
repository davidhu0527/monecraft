import { BlockId } from "./blocks";
import type { VoxelWorld } from "./voxelWorld";

/**
 * The nether generator — STUB. This shape (a bedrock-capped world with a flat
 * stone mass under one tall cavern) exists so the dimension-aware engine boot
 * lands as its own reviewable slice; the content stage replaces it wholesale
 * with the real cavern/lava-sea/glowstone passes and pins SHA-256 baselines.
 * Nothing shipped ever saves against this stub (the epic lands as one PR), so
 * the swap breaks no diff.
 *
 * Invariants the real generator must keep:
 * - Bedrock seals y=0 AND the top row: the ceiling cap is what zeroes baked
 *   skylight (lighting floods from the top row), giving the nether its dark.
 * - Deterministic per seed via lib/world/noise.ts portables only (the Bun
 *   server and every browser must agree byte-for-byte).
 * - Honors any world size (fast headless tests boot tiny worlds).
 */
export function generateNetherWorld(world: VoxelWorld): void {
  const floorTop = Math.min(40, world.sizeY - 10);
  for (let x = 0; x < world.sizeX; x += 1) {
    for (let z = 0; z < world.sizeZ; z += 1) {
      world.set(x, 0, z, BlockId.Bedrock);
      for (let y = 1; y <= floorTop; y += 1) world.set(x, y, z, BlockId.Stone);
      world.set(x, world.sizeY - 1, z, BlockId.Bedrock);
    }
  }
}
