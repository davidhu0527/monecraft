import { BlockId } from "./blocks";
import type { RedstoneBounds } from "./redstone";

/**
 * Rail block-id math (the redstone.ts/doors.ts sibling — pure id helpers, no
 * engine imports). Rails are flat floor overlays like wire; minecarts follow
 * them (see lib/game/engine/systems/vehicles.ts). The powered/detector pairs
 * belong to the redstone family and toggle by id parity; plain Rail has no
 * power state. Orientation is never stored — it derives from which neighbors
 * are rails, so extending a track reorients existing cells on the remesh.
 */

export type RailAxis = "x" | "z";

/** Anything with a get(x,y,z) — VoxelWorld structurally, without the import cycle. */
type BlockGrid = { get(x: number, y: number, z: number): number };

const RAIL_FIRST = BlockId.PoweredRail;
const RAIL_LAST = BlockId.Rail;

export function isRailBlock(block: number): block is BlockId {
  return block >= RAIL_FIRST && block <= RAIL_LAST;
}

export function isPoweredRail(block: number): boolean {
  return block === BlockId.PoweredRail || block === BlockId.PoweredRailOn;
}

export function isDetectorRail(block: number): boolean {
  return block === BlockId.DetectorRail || block === BlockId.DetectorRailOn;
}

const INSET = 1 / 16;
const RAIL_HEIGHT = 0.09;

/** Local-cell bounds for the flat rail shape (redstoneBounds sibling). */
export function railBounds(): RedstoneBounds {
  return { minX: INSET, maxX: 1 - INSET, minY: 0, maxY: RAIL_HEIGHT, minZ: INSET, maxZ: 1 - INSET };
}

/**
 * The axis a rail cell visually runs along, derived from its rail neighbors.
 * A corner cell (rail neighbors on both axes) reads as x — cosmetically fine
 * at this art resolution; cart pathing never consults this.
 */
export function railAxis(grid: BlockGrid, x: number, y: number, z: number): RailAxis {
  if (isRailBlock(grid.get(x + 1, y, z)) || isRailBlock(grid.get(x - 1, y, z))) return "x";
  if (isRailBlock(grid.get(x, y, z + 1)) || isRailBlock(grid.get(x, y, z - 1))) return "z";
  return "x";
}
