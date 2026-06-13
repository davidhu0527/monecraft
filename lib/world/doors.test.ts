import { describe, expect, test } from "bun:test";
import { BlockId, doorBlock, doorBounds, doorFacingFromYaw, doorState, isDoorBlock } from "@/lib/world";

describe("door block states", () => {
  test("round-trips facing, open state, and half through BlockId", () => {
    const block = doorBlock("east", true, true);
    expect(block).toBe(BlockId.DoorEastOpenUpper);
    expect(doorState(block)).toEqual({ facing: "east", open: true, upper: true });
    expect(isDoorBlock(block)).toBe(true);
    expect(doorState(BlockId.Stone)).toBeNull();
  });

  test("chooses the nearest cardinal facing from player yaw", () => {
    expect(doorFacingFromYaw(0)).toBe("north");
    expect(doorFacingFromYaw(-Math.PI / 2)).toBe("east");
    expect(doorFacingFromYaw(Math.PI)).toBe("south");
    expect(doorFacingFromYaw(Math.PI / 2)).toBe("west");
  });

  test("closed panels span the doorway and open panels rotate onto the hinge", () => {
    expect(doorBounds(BlockId.DoorNorthLower)).toEqual({ minX: 0, maxX: 1, minZ: 0.40625, maxZ: 0.59375 });
    expect(doorBounds(BlockId.DoorNorthOpenLower)).toEqual({ minX: 0, maxX: 0.1875, minZ: 0, maxZ: 1 });
  });
});
