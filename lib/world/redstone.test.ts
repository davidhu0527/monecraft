import { describe, expect, test } from "bun:test";
import {
  BlockId,
  isLever,
  isPressurePlate,
  isRedstoneBlock,
  isRedstoneButton,
  isRedstoneLamp,
  isRedstoneOn,
  isRedstoneOverlay,
  isRedstoneTorch,
  isRedstoneWire,
  redstoneBounds,
  redstoneOff,
  redstoneOn
} from "@/lib/world";

const ALL_REDSTONE: BlockId[] = [
  BlockId.RedstoneWire,
  BlockId.RedstoneWireOn,
  BlockId.Lever,
  BlockId.LeverOn,
  BlockId.RedstoneButton,
  BlockId.RedstoneButtonOn,
  BlockId.PressurePlate,
  BlockId.PressurePlateOn,
  BlockId.RedstoneTorchOff,
  BlockId.RedstoneTorch,
  BlockId.RedstoneLamp,
  BlockId.RedstoneLampOn
];

describe("redstone block ids", () => {
  test("family and family-member predicates", () => {
    for (const block of ALL_REDSTONE) expect(isRedstoneBlock(block)).toBe(true);
    expect(isRedstoneBlock(BlockId.Stone)).toBe(false);
    expect(isRedstoneBlock(BlockId.CoralBlue)).toBe(false);
    expect(isRedstoneWire(BlockId.RedstoneWireOn)).toBe(true);
    expect(isLever(BlockId.Lever)).toBe(true);
    expect(isRedstoneButton(BlockId.RedstoneButtonOn)).toBe(true);
    expect(isPressurePlate(BlockId.PressurePlate)).toBe(true);
    expect(isRedstoneTorch(BlockId.RedstoneTorchOff)).toBe(true);
    expect(isRedstoneLamp(BlockId.RedstoneLampOn)).toBe(true);
    expect(isRedstoneWire(BlockId.Lever)).toBe(false);
  });

  test("power state is id parity and round-trips through on/off", () => {
    for (const block of ALL_REDSTONE) {
      const on = redstoneOn(block);
      const off = redstoneOff(block);
      expect(isRedstoneOn(on)).toBe(true);
      expect(isRedstoneOn(off)).toBe(false);
      expect(redstoneOff(on)).toBe(off);
      expect(redstoneOn(off)).toBe(on);
    }
    expect(redstoneOn(BlockId.RedstoneWire)).toBe(BlockId.RedstoneWireOn);
    expect(redstoneOff(BlockId.LeverOn)).toBe(BlockId.Lever);
    expect(redstoneOn(BlockId.RedstoneTorchOff)).toBe(BlockId.RedstoneTorch);
    // Non-redstone ids never read as powered.
    expect(isRedstoneOn(BlockId.Stone)).toBe(false);
  });

  test("overlays are everything but the lamp pair", () => {
    for (const block of ALL_REDSTONE) {
      expect(isRedstoneOverlay(block)).toBe(!isRedstoneLamp(block));
    }
    expect(isRedstoneOverlay(BlockId.DoorNorthLower)).toBe(false);
  });

  test("every overlay has bounds inside the unit cell; the lamp has none", () => {
    for (const block of ALL_REDSTONE) {
      const bounds = redstoneBounds(block);
      if (isRedstoneLamp(block)) {
        expect(bounds).toBeNull();
        continue;
      }
      expect(bounds).not.toBeNull();
      expect(bounds!.minX).toBeGreaterThanOrEqual(0);
      expect(bounds!.maxX).toBeLessThanOrEqual(1);
      expect(bounds!.minY).toBe(0); // floor-mounted
      expect(bounds!.maxY).toBeLessThanOrEqual(1);
      expect(bounds!.minZ).toBeGreaterThanOrEqual(0);
      expect(bounds!.maxZ).toBeLessThanOrEqual(1);
      expect(bounds!.maxX).toBeGreaterThan(bounds!.minX);
      expect(bounds!.maxY).toBeGreaterThan(bounds!.minY);
      expect(bounds!.maxZ).toBeGreaterThan(bounds!.minZ);
    }
    expect(redstoneBounds(BlockId.Stone)).toBeNull();
  });

  test("pressed/on shapes sit lower than their released shapes", () => {
    expect(redstoneBounds(BlockId.PressurePlateOn)!.maxY).toBeLessThan(redstoneBounds(BlockId.PressurePlate)!.maxY);
    expect(redstoneBounds(BlockId.RedstoneButtonOn)!.maxY).toBeLessThan(redstoneBounds(BlockId.RedstoneButton)!.maxY);
  });
});
