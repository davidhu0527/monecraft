import { describe, expect, test } from "bun:test";
import * as THREE from "three";
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

describe("rail top-face UV orientation", () => {
  /**
   * The (u, v) sequence of the rail's TOP face at cell (4, 4, 4): six verts
   * with normal (0, 1, 0) at the rail's height (y = 4 + 0.09).
   */
  function topFaceUVs(world: VoxelWorld): string {
    const geometry = buildGeometryRegion(world, 0, world.sizeX - 1, 0, world.sizeZ - 1);
    const pos = geometry.getAttribute("position");
    const norm = geometry.getAttribute("normal");
    const uv = geometry.getAttribute("uv");
    const out: string[] = [];
    for (let i = 0; i < pos.count; i += 1) {
      const onTop = norm.getY(i) === 1 && Math.abs(pos.getY(i) - 4.09) < 1e-6;
      const inCell = pos.getX(i) >= 4 && pos.getX(i) <= 5 && pos.getZ(i) >= 4 && pos.getZ(i) <= 5;
      if (onTop && inCell) out.push(`${pos.getX(i).toFixed(2)},${pos.getZ(i).toFixed(2)}:${uv.getX(i).toFixed(4)},${uv.getY(i).toFixed(4)}`);
    }
    geometry.dispose();
    return out.join(" ");
  }

  test("a z-axis rail's top texture is the x-axis one rotated 90°", () => {
    expect(THREE).toBeDefined(); // keep the shared import used under isolated runs
    const xWorld = new VoxelWorld(8, 8, 8, 1);
    xWorld.set(4, 4, 4, BlockId.Rail);
    xWorld.set(5, 4, 4, BlockId.Rail); // east neighbor → railAxis "x"
    const zWorld = new VoxelWorld(8, 8, 8, 1);
    zWorld.set(4, 4, 4, BlockId.Rail);
    zWorld.set(4, 4, 5, BlockId.Rail); // south neighbor → railAxis "z"

    const xUVs = topFaceUVs(xWorld);
    const zUVs = topFaceUVs(zWorld);
    // Same corners, same tile — but the per-corner UV assignment is permuted
    // (the 90° rotation), so the sequences must differ.
    expect(xUVs.length).toBeGreaterThan(0);
    expect(zUVs.length).toBe(xUVs.length);
    expect(zUVs).not.toBe(xUVs);
    // And the rotation reuses the same tile: the DISTINCT UV corners match
    // (the triangle expansion duplicates different shared corners, so only
    // the deduplicated sets are comparable).
    const uvSet = (s: string) => [...new Set(s.split(" ").map((entry) => entry.split(":")[1]))].sort().join(" ");
    expect(uvSet(zUVs)).toBe(uvSet(xUVs));
  });
});
