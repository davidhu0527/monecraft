import { describe, expect, test } from "bun:test";
import { BlockId, VoxelWorld, buildGeometryRegion } from "@/lib/world";

/** Vertex count of a region mesh (positions are xyz triplets; 6 verts per face). */
function vertexCount(world: VoxelWorld): number {
  const geometry = buildGeometryRegion(world, 0, world.sizeX - 1, 0, world.sizeZ - 1);
  const count = geometry.getAttribute("position").count;
  geometry.dispose();
  return count;
}

const FACE_VERTS = 6;

describe("partial-block meshing (slabs & stairs)", () => {
  test("a lone slab emits one uncculled box (6 faces)", () => {
    const world = new VoxelWorld(8, 8, 8, 1);
    world.set(4, 4, 4, BlockId.StoneSlab);
    expect(vertexCount(world)).toBe(6 * FACE_VERTS);
  });

  test("a lone stair emits two boxes (12 faces)", () => {
    const world = new VoxelWorld(8, 8, 8, 1);
    world.set(4, 4, 4, BlockId.PlankStairsNorth);
    expect(vertexCount(world)).toBe(12 * FACE_VERTS);
  });

  test("a full cube keeps its face against a slab neighbor (no false culling)", () => {
    const world = new VoxelWorld(8, 8, 8, 1);
    world.set(4, 4, 4, BlockId.Stone);
    const alone = vertexCount(world);
    world.set(5, 4, 4, BlockId.StoneSlab);
    // The cube still draws all 6 faces (the slab only half-covers the shared
    // one); the slab adds its own 6.
    expect(vertexCount(world)).toBe(alone + 6 * FACE_VERTS);
  });

  test("two adjacent full cubes DO cull their shared faces (the baseline rule)", () => {
    const world = new VoxelWorld(8, 8, 8, 1);
    world.set(4, 4, 4, BlockId.Stone);
    const alone = vertexCount(world);
    world.set(5, 4, 4, BlockId.Stone);
    expect(vertexCount(world)).toBe(2 * alone - 2 * FACE_VERTS);
  });
});
