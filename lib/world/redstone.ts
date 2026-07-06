import { BlockId } from "./blocks";

/**
 * Redstone-lite block-id math (the doors.ts sibling — pure id helpers, no
 * engine imports). Power state is id parity: even = off, odd = on, so a
 * toggle is one block write that rides the save diff, relights, and remeshes
 * through the blockChanges.set chokepoint like a door does. The power
 * simulation itself lives in lib/game/engine/systems/redstone.ts.
 */

const REDSTONE_FIRST = BlockId.RedstoneWire;
const REDSTONE_LAST = BlockId.RedstoneLampOn;
const OVERLAY_LAST = BlockId.RedstoneTorch; // 58..67 are floor overlays; the lamp is a full cube

export type RedstoneBounds = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };

export function isRedstoneBlock(block: number): block is BlockId {
  return block >= REDSTONE_FIRST && block <= REDSTONE_LAST;
}

/** Floor-mounted, non-cube, non-colliding components (everything but the lamp). */
export function isRedstoneOverlay(block: number): boolean {
  return block >= REDSTONE_FIRST && block <= OVERLAY_LAST;
}

export function isRedstoneOn(block: number): boolean {
  return isRedstoneBlock(block) && (block & 1) === 1;
}

export function redstoneOn(block: BlockId): BlockId {
  return (block | 1) as BlockId;
}

export function redstoneOff(block: BlockId): BlockId {
  return (block & ~1) as BlockId;
}

export function isRedstoneWire(block: number): boolean {
  return block === BlockId.RedstoneWire || block === BlockId.RedstoneWireOn;
}

export function isLever(block: number): boolean {
  return block === BlockId.Lever || block === BlockId.LeverOn;
}

export function isRedstoneButton(block: number): boolean {
  return block === BlockId.RedstoneButton || block === BlockId.RedstoneButtonOn;
}

export function isPressurePlate(block: number): boolean {
  return block === BlockId.PressurePlate || block === BlockId.PressurePlateOn;
}

export function isRedstoneTorch(block: number): boolean {
  return block === BlockId.RedstoneTorchOff || block === BlockId.RedstoneTorch;
}

export function isRedstoneLamp(block: number): boolean {
  return block === BlockId.RedstoneLamp || block === BlockId.RedstoneLampOn;
}

const INSET = 1 / 16;

/** Local-cell bounds for the overlay shapes (doorBounds sibling). Null for non-overlays. */
export function redstoneBounds(block: number): RedstoneBounds | null {
  if (isRedstoneWire(block)) return { minX: INSET, maxX: 1 - INSET, minY: 0, maxY: 0.07, minZ: INSET, maxZ: 1 - INSET };
  if (isPressurePlate(block)) {
    // The pressed plate sits visibly lower.
    const height = block === BlockId.PressurePlateOn ? 0.04 : 0.07;
    return { minX: INSET, maxX: 1 - INSET, minY: 0, maxY: height, minZ: INSET, maxZ: 1 - INSET };
  }
  if (isRedstoneButton(block)) {
    const height = block === BlockId.RedstoneButtonOn ? 0.08 : 0.15;
    return { minX: 0.3, maxX: 0.7, minY: 0, maxY: height, minZ: 0.3, maxZ: 0.7 };
  }
  if (isLever(block)) return { minX: 0.35, maxX: 0.65, minY: 0, maxY: 0.45, minZ: 0.35, maxZ: 0.65 };
  if (isRedstoneTorch(block)) return { minX: 0.4, maxX: 0.6, minY: 0, maxY: 0.65, minZ: 0.4, maxZ: 0.6 };
  return null;
}
