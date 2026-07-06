import { BLOCK_COLORS, BlockId, type VoxelWorld } from "@/lib/world";

/**
 * Pure column sampling for the minimap: the top visible block of each column
 * and its display color. DOM-free so it runs under bun test; the canvas side
 * lives in minimap.ts.
 */

/**
 * Topmost non-air block of a column (water included, unlike highestSolidY).
 * In a `roofed` dimension (the nether — bedrock-capped) the scan first skips
 * the ceiling mass, so the map shows the cavern beneath, not a uniform roof;
 * a column solid to the floor reads as its (deep, dark-shaded) last block.
 */
export function topBlockAt(world: VoxelWorld, x: number, z: number, roofed = false): { block: BlockId; y: number } {
  let y = world.sizeY - 1;
  if (roofed) {
    while (y > 0 && world.get(x, y, z) !== BlockId.Air) y -= 1;
  }
  for (; y >= 0; y -= 1) {
    const block = world.get(x, y, z);
    if (block !== BlockId.Air) return { block: block as BlockId, y };
  }
  return { block: BlockId.Air, y: 0 };
}

const FALLBACK: [number, number, number] = [0.45, 0.45, 0.45];

/**
 * Display color (0–255 RGB) for a column: the top block's atlas color with
 * height-based brightness so terrain relief reads on the map.
 */
export function columnColor(world: VoxelWorld, x: number, z: number, roofed = false): [number, number, number] {
  const { block, y } = topBlockAt(world, x, z, roofed);
  if (block === BlockId.Air) return [0, 0, 0];
  const base = BLOCK_COLORS[block] ?? FALLBACK;
  // Brightness 0.6 at bedrock level up to 1.1 at the world ceiling.
  const shade = 0.6 + (y / Math.max(1, world.sizeY - 1)) * 0.5;
  return [
    Math.max(0, Math.min(255, Math.round(base[0] * 255 * shade))),
    Math.max(0, Math.min(255, Math.round(base[1] * 255 * shade))),
    Math.max(0, Math.min(255, Math.round(base[2] * 255 * shade)))
  ];
}
