import { BlockId } from "./blocks";

export type DoorFacing = "north" | "east" | "south" | "west";
export type DoorState = { facing: DoorFacing; open: boolean; upper: boolean };
export type DoorBounds = { minX: number; maxX: number; minZ: number; maxZ: number };

export const DOOR_BLOCK_IDS: readonly BlockId[] = [
  BlockId.DoorNorthLower,
  BlockId.DoorNorthUpper,
  BlockId.DoorEastLower,
  BlockId.DoorEastUpper,
  BlockId.DoorSouthLower,
  BlockId.DoorSouthUpper,
  BlockId.DoorWestLower,
  BlockId.DoorWestUpper,
  BlockId.DoorNorthOpenLower,
  BlockId.DoorNorthOpenUpper,
  BlockId.DoorEastOpenLower,
  BlockId.DoorEastOpenUpper,
  BlockId.DoorSouthOpenLower,
  BlockId.DoorSouthOpenUpper,
  BlockId.DoorWestOpenLower,
  BlockId.DoorWestOpenUpper
];

const FACING_ORDER: readonly DoorFacing[] = ["north", "east", "south", "west"];
const DOOR_FIRST = BlockId.DoorNorthLower;
const DOOR_LAST = BlockId.DoorWestOpenUpper;
const THICKNESS = 3 / 16;

export function isDoorBlock(block: number): block is BlockId {
  return block >= DOOR_FIRST && block <= DOOR_LAST;
}

export function doorState(block: number): DoorState | null {
  if (!isDoorBlock(block)) return null;
  const index = block - DOOR_FIRST;
  return {
    facing: FACING_ORDER[Math.floor((index % 8) / 2)],
    open: index >= 8,
    upper: index % 2 === 1
  };
}

export function doorBlock(facing: DoorFacing, open: boolean, upper: boolean): BlockId {
  const facingIndex = FACING_ORDER.indexOf(facing);
  return (DOOR_FIRST + (open ? 8 : 0) + facingIndex * 2 + (upper ? 1 : 0)) as BlockId;
}

export function doorFacingFromYaw(yaw: number): DoorFacing {
  const x = -Math.sin(yaw);
  const z = -Math.cos(yaw);
  if (Math.abs(x) > Math.abs(z)) return x > 0 ? "east" : "west";
  return z > 0 ? "south" : "north";
}

/** Local x/z bounds for the thin panel. Open panels rotate onto their hinge edge. */
export function doorBounds(block: number): DoorBounds | null {
  const state = doorState(block);
  if (!state) return null;
  const half = THICKNESS / 2;
  if (!state.open) {
    if (state.facing === "north" || state.facing === "south") return { minX: 0, maxX: 1, minZ: 0.5 - half, maxZ: 0.5 + half };
    return { minX: 0.5 - half, maxX: 0.5 + half, minZ: 0, maxZ: 1 };
  }
  if (state.facing === "north") return { minX: 0, maxX: THICKNESS, minZ: 0, maxZ: 1 };
  if (state.facing === "south") return { minX: 1 - THICKNESS, maxX: 1, minZ: 0, maxZ: 1 };
  if (state.facing === "east") return { minX: 0, maxX: 1, minZ: 1 - THICKNESS, maxZ: 1 };
  return { minX: 0, maxX: 1, minZ: 0, maxZ: THICKNESS };
}
