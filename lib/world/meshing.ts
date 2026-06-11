import * as THREE from "three";
import { ATLAS_COLUMNS, ATLAS_FACE_VARIANTS, tileIndexFor } from "./atlas";
import { BlockId } from "./blocks";
import { VoxelWorld } from "./voxelWorld";

const FACE_DEFS: {
  dir: [number, number, number];
  corners: [number, number, number][];
}[] = [
  {
    dir: [1, 0, 0],
    corners: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1]
    ]
  },
  {
    dir: [-1, 0, 0],
    corners: [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0]
    ]
  },
  {
    dir: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0]
    ]
  },
  {
    dir: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1]
    ]
  },
  {
    dir: [0, 0, 1],
    corners: [
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
      [0, 0, 1]
    ]
  },
  {
    dir: [0, 0, -1],
    corners: [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0]
    ]
  }
];

/**
 * Builds a single triangle-soup BufferGeometry for the given world region with
 * face culling (hidden faces skipped), per-face ambient occlusion baked into
 * vertex colors, and atlas UVs. Water only renders faces against non-water.
 */
export function buildGeometryRegion(
  world: VoxelWorld,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  minY = 0,
  maxY = world.sizeY - 1
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];

  const clampedMinX = Math.max(0, minX);
  const clampedMaxX = Math.min(world.sizeX - 1, maxX);
  const clampedMinZ = Math.max(0, minZ);
  const clampedMaxZ = Math.min(world.sizeZ - 1, maxZ);
  const clampedMinY = Math.max(0, minY);
  const clampedMaxY = Math.min(world.sizeY - 1, maxY);

  const pushVertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number, color: [number, number, number], u: number, v: number) => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    colors.push(color[0], color[1], color[2]);
    uvs.push(u, v);
  };
  const materialTint = (ny: number): [number, number, number] => {
    const shade = ny > 0 ? 1 : ny < 0 ? 0.95 : 0.9;
    return [shade, shade, shade];
  };

  const tileUV = (block: number, ny: number): [number, number, number, number] => {
    const face = ny > 0 ? "top" : ny < 0 ? "bottom" : "side";
    const tile = tileIndexFor(block, face);
    const col = tile % ATLAS_COLUMNS;
    const row = Math.floor(tile / ATLAS_COLUMNS);
    const rows = Math.ceil(((BlockId.Water + 1) * ATLAS_FACE_VARIANTS) / ATLAS_COLUMNS);
    const pad = 0.0008;
    const u0 = col / ATLAS_COLUMNS + pad;
    const v0 = row / rows + pad;
    const u1 = (col + 1) / ATLAS_COLUMNS - pad;
    const v1 = (row + 1) / rows - pad;
    return [u0, v0, u1, v1];
  };

  const faceOcclusion = (x: number, y: number, z: number, nx: number, ny: number, nz: number): number => {
    const ax = nz;
    const ay = 0;
    const az = -nx;
    const bx = 0;
    const by = 1;
    const bz = 0;

    const sx = x + nx;
    const sy = y + ny;
    const sz = z + nz;

    let occ = 0;
    if (world.isSolid(sx + ax, sy + ay, sz + az)) occ += 1;
    if (world.isSolid(sx - ax, sy - ay, sz - az)) occ += 1;
    if (world.isSolid(sx + bx, sy + by, sz + bz)) occ += 1;
    if (world.isSolid(sx - bx, sy - by, sz - bz)) occ += 1;
    return Math.max(0.8, 1 - occ * 0.06);
  };

  for (let y = clampedMinY; y <= clampedMaxY; y += 1) {
    for (let z = clampedMinZ; z <= clampedMaxZ; z += 1) {
      for (let x = clampedMinX; x <= clampedMaxX; x += 1) {
        const block = world.get(x, y, z);
        if (block === BlockId.Air) continue;
        for (const face of FACE_DEFS) {
          const nx = face.dir[0];
          const ny = face.dir[1];
          const nz = face.dir[2];
          const neighbor = world.get(x + nx, y + ny, z + nz);
          if (block === BlockId.Water) {
            if (neighbor === BlockId.Water) continue;
          } else if (world.isSolid(x + nx, y + ny, z + nz)) continue;

          const base = materialTint(ny);
          const ao = faceOcclusion(x, y, z, nx, ny, nz);
          const color: [number, number, number] = [base[0] * ao, base[1] * ao, base[2] * ao];
          const [u0, v0, u1, v1] = tileUV(block, ny);

          const a = face.corners[0];
          const b = face.corners[1];
          const c = face.corners[2];
          const d = face.corners[3];

          pushVertex(x + a[0], y + a[1], z + a[2], nx, ny, nz, color, u0, v1);
          pushVertex(x + b[0], y + b[1], z + b[2], nx, ny, nz, color, u0, v0);
          pushVertex(x + c[0], y + c[1], z + c[2], nx, ny, nz, color, u1, v0);
          pushVertex(x + a[0], y + a[1], z + a[2], nx, ny, nz, color, u0, v1);
          pushVertex(x + c[0], y + c[1], z + c[2], nx, ny, nz, color, u1, v0);
          pushVertex(x + d[0], y + d[1], z + d[2], nx, ny, nz, color, u1, v1);
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  return geometry;
}
