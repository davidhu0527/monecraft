import * as THREE from "three";
import { BiomeId, BlockId, VoxelWorld } from "@/lib/world";

export type SurfaceYAtFn = (x: number, z: number) => number;

export function createSurfaceYAt(world: VoxelWorld): SurfaceYAtFn {
  return (x: number, z: number) => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    if (ix < 0 || iz < 0 || ix >= world.sizeX || iz >= world.sizeZ) return 1;
    return world.highestSolidY(ix, iz) + 1;
  };
}

/**
 * Deterministic spiral search for a safe spawn column: solid dry floor, two
 * air blocks for the body, gently sloped neighbors, preferring Plains. Falls
 * back to any biome, then to the search center.
 */
export function findSpawnOnLand(world: VoxelWorld, centerX: number, centerZ: number, seekPlains = true): { x: number; y: number; z: number } {
  const isGoodSpawn = (x: number, y: number, z: number): boolean => {
    const top = world.get(x, y - 1, z);
    const atBody = world.get(x, y, z);
    const atHead = world.get(x, y + 1, z);
    if (!world.isSolid(x, y - 1, z)) return false;
    if (atBody === BlockId.Water || atHead === BlockId.Water || top === BlockId.Water) return false;
    if (atBody !== BlockId.Air || atHead !== BlockId.Air) return false;
    if (seekPlains && world.getBiome(x, z) !== BiomeId.Plains) return false;

    const h0 = world.highestSolidY(x + 1, z);
    const h1 = world.highestSolidY(x - 1, z);
    const h2 = world.highestSolidY(x, z + 1);
    const h3 = world.highestSolidY(x, z - 1);
    const ny = y - 1;
    return Math.abs(h0 - ny) <= 2 && Math.abs(h1 - ny) <= 2 && Math.abs(h2 - ny) <= 2 && Math.abs(h3 - ny) <= 2;
  };

  const maxRadius = Math.min(300, Math.floor(Math.min(world.sizeX, world.sizeZ) * 0.4));
  for (let radius = 0; radius <= maxRadius; radius += 2) {
    for (let i = 0; i < 32; i += 1) {
      const angle = (Math.PI * 2 * i) / 32;
      const x = Math.max(5, Math.min(world.sizeX - 6, Math.floor(centerX + Math.cos(angle) * radius)));
      const z = Math.max(5, Math.min(world.sizeZ - 6, Math.floor(centerZ + Math.sin(angle) * radius)));
      const topY = world.highestSolidY(x, z);
      const y = topY + 1;
      if (isGoodSpawn(x, y, z)) return { x, y, z };
    }
  }

  if (seekPlains) return findSpawnOnLand(world, centerX, centerZ, false);

  const topY = world.highestSolidY(centerX, centerZ);
  return { x: centerX, y: topY + 1, z: centerZ };
}

export function randomLandPoint(world: VoxelWorld, surfaceYAt: SurfaceYAtFn, rng: () => number = Math.random): THREE.Vector3 {
  for (let i = 0; i < 40; i += 1) {
    const x = 10 + rng() * (world.sizeX - 20);
    const z = 10 + rng() * (world.sizeZ - 20);
    const y = surfaceYAt(x, z);
    if (y > 2) return new THREE.Vector3(x, y, z);
  }
  return new THREE.Vector3(world.sizeX / 2, 12, world.sizeZ / 2);
}

export function randomLandPointNear(
  world: VoxelWorld,
  surfaceYAt: SurfaceYAtFn,
  centerX: number,
  centerZ: number,
  radius: number,
  rng: () => number = Math.random
): THREE.Vector3 {
  for (let i = 0; i < 50; i += 1) {
    const x = centerX + (rng() * 2 - 1) * radius;
    const z = centerZ + (rng() * 2 - 1) * radius;
    const clampedX = Math.max(10, Math.min(world.sizeX - 10, x));
    const clampedZ = Math.max(10, Math.min(world.sizeZ - 10, z));
    const y = surfaceYAt(clampedX, clampedZ);
    if (y > 2) return new THREE.Vector3(clampedX, y, clampedZ);
  }
  return randomLandPoint(world, surfaceYAt, rng);
}
