import { BlockId } from "./blocks";
import type { DoorFacing } from "./doors";

/**
 * Slab and stair block-id math (the doors.ts sibling — pure id helpers, no
 * engine imports). Slabs fill the bottom half of their cell; a stair is the
 * slab plus a half-height back on the side it FACES (4 contiguous ids per
 * material, doors-style offset math). Both mesh and collide from the same
 * shape boxes — `shapeBoxes` is the single geometry truth shared by
 * meshing.ts and queries.ts, the first partial-Y collision in the game
 * (doors are partial only in x/z).
 */

export type StairFacing = DoorFacing;

/** One axis-aligned box in local cell coordinates (0..1 on each axis). */
export type ShapeBox = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };

export type SlabMaterial = "plank" | "stone" | "cobble";

const SLAB_FIRST = BlockId.PlankSlab;
const SLAB_LAST = BlockId.CobbleSlab;
const STAIR_FIRST = BlockId.PlankStairsNorth;
const STAIR_LAST = BlockId.CobbleStairsWest;

const FACING_ORDER: readonly StairFacing[] = ["north", "east", "south", "west"];

const STAIR_FIRST_BY_MATERIAL: Record<SlabMaterial, BlockId> = {
  plank: BlockId.PlankStairsNorth,
  stone: BlockId.StoneStairsNorth,
  cobble: BlockId.CobbleStairsNorth
};

export function isSlabBlock(block: number): block is BlockId {
  return block >= SLAB_FIRST && block <= SLAB_LAST;
}

export function isStairBlock(block: number): block is BlockId {
  return block >= STAIR_FIRST && block <= STAIR_LAST;
}

/** Any half-shape building block — the mesher/collision partial-box path. */
export function isPartialBlock(block: number): boolean {
  return block >= SLAB_FIRST && block <= STAIR_LAST;
}

export function stairFacing(block: number): StairFacing | null {
  if (!isStairBlock(block)) return null;
  return FACING_ORDER[(block - STAIR_FIRST) % 4];
}

export function stairBlock(material: SlabMaterial, facing: StairFacing): BlockId {
  return (STAIR_FIRST_BY_MATERIAL[material] + FACING_ORDER.indexOf(facing)) as BlockId;
}

/** The same stair re-oriented — placement turns the item's base (north) id by player yaw. */
export function orientStair(block: BlockId, facing: StairFacing): BlockId {
  if (!isStairBlock(block)) return block;
  return (block - ((block - STAIR_FIRST) % 4) + FACING_ORDER.indexOf(facing)) as BlockId;
}

const BOTTOM_HALF: ShapeBox = Object.freeze({ minX: 0, maxX: 1, minY: 0, maxY: 0.5, minZ: 0, maxZ: 1 });

// The stair's raised back occupies the half-cell on the side it faces
// (facing = the direction the high step climbs toward; see doorFacingFromYaw's
// axis convention: north = -z, east = +x).
const STAIR_TOPS: Record<StairFacing, ShapeBox> = {
  north: Object.freeze({ minX: 0, maxX: 1, minY: 0.5, maxY: 1, minZ: 0, maxZ: 0.5 }),
  east: Object.freeze({ minX: 0.5, maxX: 1, minY: 0.5, maxY: 1, minZ: 0, maxZ: 1 }),
  south: Object.freeze({ minX: 0, maxX: 1, minY: 0.5, maxY: 1, minZ: 0.5, maxZ: 1 }),
  west: Object.freeze({ minX: 0, maxX: 0.5, minY: 0.5, maxY: 1, minZ: 0, maxZ: 1 })
};

const SLAB_BOXES: readonly ShapeBox[] = Object.freeze([BOTTOM_HALF]);
const STAIR_BOXES: Record<StairFacing, readonly ShapeBox[]> = {
  north: Object.freeze([BOTTOM_HALF, STAIR_TOPS.north]),
  east: Object.freeze([BOTTOM_HALF, STAIR_TOPS.east]),
  south: Object.freeze([BOTTOM_HALF, STAIR_TOPS.south]),
  west: Object.freeze([BOTTOM_HALF, STAIR_TOPS.west])
};

/**
 * The 1–2 boxes a partial block occupies, in local cell coords. Cached and
 * frozen — collision runs this per body-overlapped cell per physics step, so
 * it must never allocate. Null for non-partial blocks.
 */
export function shapeBoxes(block: number): readonly ShapeBox[] | null {
  if (isSlabBlock(block)) return SLAB_BOXES;
  const facing = stairFacing(block);
  return facing ? STAIR_BOXES[facing] : null;
}
