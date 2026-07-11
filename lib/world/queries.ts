import * as THREE from "three";
import { BlockId } from "./blocks";
import { VoxelWorld } from "./voxelWorld";
import { doorBounds, isDoorBlock } from "./doors";
import { isRailBlock } from "./rails";
import { isRedstoneOverlay } from "./redstone";
import { isPartialBlock, shapeBoxes } from "./slabs";

export type RaycastResult = {
  hit: THREE.Vector3;
  previous: THREE.Vector3;
  /** Ray parameter where the ray enters the hit cell (0 when the origin cell is already solid). */
  distance: number;
};

// DDA voxel traversal. `previous` is the last empty cell before the hit —
// face-adjacent to it, never diagonal — which is where placed blocks go.
export function voxelRaycast(world: VoxelWorld, origin: THREE.Vector3, direction: THREE.Vector3, maxDist = 6): RaycastResult | null {
  const dir = direction.clone().normalize();
  const pos = origin.clone();

  let x = Math.floor(pos.x);
  let y = Math.floor(pos.y);
  let z = Math.floor(pos.z);

  const stepX = dir.x > 0 ? 1 : -1;
  const stepY = dir.y > 0 ? 1 : -1;
  const stepZ = dir.z > 0 ? 1 : -1;

  // An axis the ray doesn't travel must NEVER step: its tMax is Infinity.
  // The old `dir.x || 1e-6` fallback broke this two ways for a (near-)zero
  // component — `-0` is falsy, so the epsilon could carry the WRONG SIGN vs
  // the already-chosen step, and an origin exactly on a cell boundary made
  // tMax compute to 0, walking the ray sideways into a neighbor column at
  // t=0. A player seated at exact integer coordinates (the server spawn)
  // aiming straight down then mined the DIAGONAL column — or, once that
  // column was hollow, nothing at all.
  const flat = 1e-9;
  const invDx = Math.abs(dir.x) < flat ? Infinity : Math.abs(1 / dir.x);
  const invDy = Math.abs(dir.y) < flat ? Infinity : Math.abs(1 / dir.y);
  const invDz = Math.abs(dir.z) < flat ? Infinity : Math.abs(1 / dir.z);

  let tMaxX = Math.abs(dir.x) < flat ? Infinity : ((stepX > 0 ? x + 1 : x) - pos.x) / dir.x;
  let tMaxY = Math.abs(dir.y) < flat ? Infinity : ((stepY > 0 ? y + 1 : y) - pos.y) / dir.y;
  let tMaxZ = Math.abs(dir.z) < flat ? Infinity : ((stepZ > 0 ? z + 1 : z) - pos.z) / dir.z;
  if (tMaxX < 0) tMaxX += invDx;
  if (tMaxY < 0) tMaxY += invDy;
  if (tMaxZ < 0) tMaxZ += invDz;

  let t = 0;
  let previous = new THREE.Vector3(x, y, z);

  while (t <= maxDist) {
    if (world.isSolid(x, y, z)) return { hit: new THREE.Vector3(x, y, z), previous, distance: t };
    previous = new THREE.Vector3(x, y, z);

    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        x += stepX;
        t = tMaxX;
        tMaxX += invDx;
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += invDz;
      }
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += invDy;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += invDz;
    }
  }

  return null;
}

/**
 * Marches the ray and returns the first Water cell whose cell above is Air — the
 * water *surface* the player is aiming at (for casting a fishing bobber). Returns
 * null if a solid block is hit first (you can't fish through terrain) or no such
 * water cell is reached within `maxDist`. Mirrors `voxelRaycast`'s DDA; the normal
 * raycast can't be reused because it treats water as empty and passes through it.
 */
export function waterSurfaceRaycast(world: VoxelWorld, origin: THREE.Vector3, direction: THREE.Vector3, maxDist = 7): THREE.Vector3 | null {
  const dir = direction.clone().normalize();
  const pos = origin.clone();

  let x = Math.floor(pos.x);
  let y = Math.floor(pos.y);
  let z = Math.floor(pos.z);

  const stepX = dir.x > 0 ? 1 : -1;
  const stepY = dir.y > 0 ? 1 : -1;
  const stepZ = dir.z > 0 ? 1 : -1;

  // An axis the ray doesn't travel must NEVER step: its tMax is Infinity.
  // The old `dir.x || 1e-6` fallback broke this two ways for a (near-)zero
  // component — `-0` is falsy, so the epsilon could carry the WRONG SIGN vs
  // the already-chosen step, and an origin exactly on a cell boundary made
  // tMax compute to 0, walking the ray sideways into a neighbor column at
  // t=0. A player seated at exact integer coordinates (the server spawn)
  // aiming straight down then mined the DIAGONAL column — or, once that
  // column was hollow, nothing at all.
  const flat = 1e-9;
  const invDx = Math.abs(dir.x) < flat ? Infinity : Math.abs(1 / dir.x);
  const invDy = Math.abs(dir.y) < flat ? Infinity : Math.abs(1 / dir.y);
  const invDz = Math.abs(dir.z) < flat ? Infinity : Math.abs(1 / dir.z);

  let tMaxX = Math.abs(dir.x) < flat ? Infinity : ((stepX > 0 ? x + 1 : x) - pos.x) / dir.x;
  let tMaxY = Math.abs(dir.y) < flat ? Infinity : ((stepY > 0 ? y + 1 : y) - pos.y) / dir.y;
  let tMaxZ = Math.abs(dir.z) < flat ? Infinity : ((stepZ > 0 ? z + 1 : z) - pos.z) / dir.z;
  if (tMaxX < 0) tMaxX += invDx;
  if (tMaxY < 0) tMaxY += invDy;
  if (tMaxZ < 0) tMaxZ += invDz;

  let t = 0;
  while (t <= maxDist) {
    if (world.isSolid(x, y, z)) return null; // terrain blocks the cast
    if (world.get(x, y, z) === BlockId.Water && world.get(x, y + 1, z) === BlockId.Air) {
      return new THREE.Vector3(x, y, z);
    }

    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        x += stepX;
        t = tMaxX;
        tMaxX += invDx;
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += invDz;
      }
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += invDy;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += invDz;
    }
  }

  return null;
}

// AABB-vs-voxel test. `position` is the feet center; the box extends halfWidth
// on x/z and height on y. Water never collides.
export function collidesAt(world: VoxelWorld, position: THREE.Vector3, halfWidth: number, height: number): boolean {
  const eps = 0.001;
  const minX = Math.floor(position.x - halfWidth + eps);
  const maxX = Math.floor(position.x + halfWidth - eps);
  const minZ = Math.floor(position.z - halfWidth + eps);
  const maxZ = Math.floor(position.z + halfWidth - eps);
  const minY = Math.floor(position.y + eps);
  const maxY = Math.floor(position.y + height - eps);

  for (let y = minY; y <= maxY; y += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const block = world.get(x, y, z);
        if (!world.isSolid(x, y, z)) continue;
        // Redstone overlays never collide — you walk over wire and plates
        // (feet occupying the plate's cell is exactly what detection needs).
        // Rails share the rule: carts glide over them, players step across.
        if (isRedstoneOverlay(block) || isRailBlock(block)) continue;
        // Slabs and stairs collide box-by-box — the first partial-Y collision
        // (doors below are partial only in x/z). Standing ON a slab's top face
        // must not collide, which is what makes auto-step-up land on it.
        if (isPartialBlock(block)) {
          const bodyMinX = position.x - halfWidth + eps;
          const bodyMaxX = position.x + halfWidth - eps;
          const bodyMinZ = position.z - halfWidth + eps;
          const bodyMaxZ = position.z + halfWidth - eps;
          const bodyMinY = position.y + eps;
          const bodyMaxY = position.y + height - eps;
          for (const box of shapeBoxes(block)!) {
            if (
              bodyMaxX > x + box.minX &&
              bodyMinX < x + box.maxX &&
              bodyMaxZ > z + box.minZ &&
              bodyMinZ < z + box.maxZ &&
              bodyMaxY > y + box.minY &&
              bodyMinY < y + box.maxY
            ) {
              return true;
            }
          }
          continue;
        }
        if (!isDoorBlock(block)) return true;
        const bounds = doorBounds(block)!;
        const bodyMinX = position.x - halfWidth + eps;
        const bodyMaxX = position.x + halfWidth - eps;
        const bodyMinZ = position.z - halfWidth + eps;
        const bodyMaxZ = position.z + halfWidth - eps;
        if (bodyMaxX > x + bounds.minX && bodyMinX < x + bounds.maxX && bodyMaxZ > z + bounds.minZ && bodyMinZ < z + bounds.maxZ) return true;
      }
    }
  }

  return false;
}

export function hasSupportUnderPlayer(world: VoxelWorld, position: THREE.Vector3, halfWidth: number): boolean {
  const minX = Math.floor(position.x - halfWidth);
  const maxX = Math.floor(position.x + halfWidth);
  const minZ = Math.floor(position.z - halfWidth);
  const maxZ = Math.floor(position.z + halfWidth);
  const y = Math.floor(position.y - 0.05);

  for (let z = minZ; z <= maxZ; z += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (world.isSolid(x, y, z)) return true;
    }
  }

  return false;
}
