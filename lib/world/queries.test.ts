import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BlockId, VoxelWorld, collidesAt, hasSupportUnderPlayer, voxelRaycast, waterSurfaceRaycast } from "@/lib/world";
import { createSurfaceYAt } from "@/lib/game/spawn";

function emptyWorld(): VoxelWorld {
  return new VoxelWorld(16, 16, 16, 1);
}

describe("voxelRaycast", () => {
  test("axis-aligned ray hits the first solid block and reports the cell before it", () => {
    const world = emptyWorld();
    world.set(8, 5, 5, BlockId.Stone);
    const result = voxelRaycast(world, new THREE.Vector3(2.5, 5.5, 5.5), new THREE.Vector3(1, 0, 0), 10);
    expect(result).not.toBeNull();
    expect(result!.hit.toArray()).toEqual([8, 5, 5]);
    expect(result!.previous.toArray()).toEqual([7, 5, 5]);
  });

  test("an on-boundary origin with a zero component never steps that axis (the spawn-seat degeneracy)", () => {
    // A fresh online joiner is seated at EXACT integer coordinates — on the
    // cell boundary — and an axis-aligned look direction has a (negative-)zero
    // component on the other axes. The old `dir || 1e-6` fallback stepped the
    // ray sideways into a neighbor column at t=0 (its epsilon could even carry
    // the wrong sign for -0), so "dig straight down" mined the DIAGONAL column
    // — or nothing, once that column was hollow. The zero axis must never step.
    const world = emptyWorld();
    world.set(5, 5, 5, BlockId.Stone); // directly below the on-boundary origin's column
    // Origin exactly on the x and z boundaries of cell (5,·,5), aiming straight down.
    const down = new THREE.Vector3(-0, -1, -0);
    const result = voxelRaycast(world, new THREE.Vector3(5.0, 8.0, 5.0), down, 10);
    expect(result).not.toBeNull();
    expect(result!.hit.toArray()).toEqual([5, 5, 5]);
    expect(result!.previous.toArray()).toEqual([5, 6, 5]);
    // The neighbor columns are untouched by the traversal: with nothing in
    // this column, the ray must miss entirely rather than drift sideways.
    const emptied = emptyWorld();
    emptied.set(4, 5, 4, BlockId.Stone); // diagonal neighbor — must NOT be found
    expect(voxelRaycast(emptied, new THREE.Vector3(5.0, 8.0, 5.0), down, 10)).toBeNull();
  });

  test("a genuinely tilted ray from an on-boundary origin enters the neighbor column it points into", () => {
    // Correct geometry, preserved: moving -z from exactly z=5.0 leaves the
    // z=5 cell immediately, so a slightly tilted down-aim samples the
    // neighbor column — that's physics, not the degeneracy above.
    const world = emptyWorld();
    world.set(5, 5, 4, BlockId.Stone);
    const tilted = new THREE.Vector3(0, -Math.cos(0.02), -Math.sin(0.02));
    const result = voxelRaycast(world, new THREE.Vector3(5.5, 8.0, 5.0), tilted, 10);
    expect(result).not.toBeNull();
    expect(result!.hit.toArray()).toEqual([5, 5, 4]);
  });

  test("diagonal ray traverses cells without skipping through corners", () => {
    const world = emptyWorld();
    world.set(6, 6, 6, BlockId.Stone);
    const result = voxelRaycast(world, new THREE.Vector3(2.5, 2.5, 2.5), new THREE.Vector3(1, 1, 1), 12);
    expect(result).not.toBeNull();
    expect(result!.hit.toArray()).toEqual([6, 6, 6]);
    // The previous cell must be face-adjacent to the hit, never diagonal.
    const diff = result!.hit.clone().sub(result!.previous);
    expect(Math.abs(diff.x) + Math.abs(diff.y) + Math.abs(diff.z)).toBe(1);
  });

  test("reports the distance where the ray enters the hit cell", () => {
    const world = emptyWorld();
    world.set(8, 5, 5, BlockId.Stone);
    const result = voxelRaycast(world, new THREE.Vector3(2.5, 5.5, 5.5), new THREE.Vector3(1, 0, 0), 10);
    expect(result).not.toBeNull();
    // Origin x=2.5 to the x=8 cell face is 5.5 units along the ray.
    expect(result!.distance).toBeCloseTo(5.5);
  });

  test("distance is zero when the origin cell is already solid", () => {
    const world = emptyWorld();
    world.set(5, 5, 5, BlockId.Stone);
    const result = voxelRaycast(world, new THREE.Vector3(5.5, 5.5, 5.5), new THREE.Vector3(1, 0, 0), 5);
    expect(result).not.toBeNull();
    expect(result!.distance).toBe(0);
  });

  test("returns null when no solid block is within maxDist", () => {
    const world = emptyWorld();
    world.set(12, 5, 5, BlockId.Stone);
    expect(voxelRaycast(world, new THREE.Vector3(2.5, 5.5, 5.5), new THREE.Vector3(1, 0, 0), 5)).toBeNull();
  });

  test("ray starting inside a solid block hits it immediately", () => {
    const world = emptyWorld();
    world.set(5, 5, 5, BlockId.Stone);
    const result = voxelRaycast(world, new THREE.Vector3(5.5, 5.5, 5.5), new THREE.Vector3(1, 0, 0), 5);
    expect(result).not.toBeNull();
    expect(result!.hit.toArray()).toEqual([5, 5, 5]);
  });

  test("water is not a raycast target", () => {
    const world = emptyWorld();
    world.set(8, 5, 5, BlockId.Water);
    expect(voxelRaycast(world, new THREE.Vector3(2.5, 5.5, 5.5), new THREE.Vector3(1, 0, 0), 10)).toBeNull();
  });

  test("near-zero direction components do not divide by zero", () => {
    const world = emptyWorld();
    world.set(5, 8, 5, BlockId.Stone);
    const result = voxelRaycast(world, new THREE.Vector3(5.5, 2.5, 5.5), new THREE.Vector3(0, 1, 0), 10);
    expect(result).not.toBeNull();
    expect(result!.hit.toArray()).toEqual([5, 8, 5]);
  });
});

describe("waterSurfaceRaycast", () => {
  // A water column with air above it at x=8; the player looks along +x from x=2.5.
  function waterWorld(): VoxelWorld {
    const world = emptyWorld();
    world.set(8, 5, 5, BlockId.Water); // surface cell (air above by default)
    world.set(8, 4, 5, BlockId.Water); // deeper water
    return world;
  }

  test("returns the first water-surface cell along the ray", () => {
    const hit = waterSurfaceRaycast(waterWorld(), new THREE.Vector3(2.5, 5.5, 5.5), new THREE.Vector3(1, 0, 0), 10);
    expect(hit).not.toBeNull();
    expect(hit!.toArray()).toEqual([8, 5, 5]);
  });

  test("returns null when a solid block blocks the way to the water", () => {
    const world = waterWorld();
    world.set(5, 5, 5, BlockId.Stone); // wall between the player and the water
    expect(waterSurfaceRaycast(world, new THREE.Vector3(2.5, 5.5, 5.5), new THREE.Vector3(1, 0, 0), 10)).toBeNull();
  });

  test("returns null when no water is within reach", () => {
    expect(waterSurfaceRaycast(emptyWorld(), new THREE.Vector3(2.5, 5.5, 5.5), new THREE.Vector3(1, 0, 0), 10)).toBeNull();
  });

  test("skips a submerged water cell whose cell above is also water", () => {
    // Aiming at the deeper cell (y=4) along its row still finds nothing: it has
    // water above, so it is not a surface. Only the y=5 surface cell qualifies.
    const world = emptyWorld();
    world.set(8, 4, 5, BlockId.Water);
    world.set(8, 5, 5, BlockId.Water);
    const hit = waterSurfaceRaycast(world, new THREE.Vector3(2.5, 4.5, 5.5), new THREE.Vector3(1, 0, 0), 10);
    expect(hit).toBeNull();
  });
});

describe("collidesAt", () => {
  // Player AABB: position is the feet center, halfWidth extends on x/z, height on y.
  test("collides when feet overlap a solid block", () => {
    const world = emptyWorld();
    world.set(5, 5, 5, BlockId.Stone);
    expect(collidesAt(world, new THREE.Vector3(5.5, 5.5, 5.5), 0.3, 1.8)).toBe(true);
  });

  test("does not collide when standing on top of a block", () => {
    const world = emptyWorld();
    world.set(5, 5, 5, BlockId.Stone);
    expect(collidesAt(world, new THREE.Vector3(5.5, 6.0, 5.5), 0.3, 1.8)).toBe(false);
  });

  test("collides when the head overlaps a block above", () => {
    const world = emptyWorld();
    world.set(5, 7, 5, BlockId.Stone);
    expect(collidesAt(world, new THREE.Vector3(5.5, 6.0, 5.5), 0.3, 1.8)).toBe(true);
  });

  test("water is not a collision", () => {
    const world = emptyWorld();
    world.set(5, 5, 5, BlockId.Water);
    expect(collidesAt(world, new THREE.Vector3(5.5, 5.5, 5.5), 0.3, 1.8)).toBe(false);
  });

  test("wide hitboxes clip blocks adjacent to the center column", () => {
    const world = emptyWorld();
    world.set(6, 5, 5, BlockId.Stone);
    expect(collidesAt(world, new THREE.Vector3(5.9, 5.5, 5.5), 0.3, 1.8)).toBe(true);
    expect(collidesAt(world, new THREE.Vector3(5.5, 5.5, 5.5), 0.3, 1.8)).toBe(false);
  });

  test("epsilon keeps a position exactly on a block boundary from colliding with the far cell", () => {
    const world = emptyWorld();
    world.set(6, 5, 5, BlockId.Stone);
    // Right edge of the AABB lands exactly on x=6.0; the epsilon excludes cell 6.
    expect(collidesAt(world, new THREE.Vector3(5.7, 5.5, 5.5), 0.3, 1.8)).toBe(false);
  });

  test("rails never collide — players walk across track, carts glide over it", () => {
    const world = emptyWorld();
    world.set(5, 5, 5, BlockId.Rail);
    world.set(6, 5, 5, BlockId.PoweredRailOn);
    world.set(7, 5, 5, BlockId.DetectorRail);
    expect(collidesAt(world, new THREE.Vector3(5.5, 5.0, 5.5), 0.3, 1.8)).toBe(false);
    expect(collidesAt(world, new THREE.Vector3(6.5, 5.0, 5.5), 0.3, 1.8)).toBe(false);
    expect(collidesAt(world, new THREE.Vector3(7.5, 5.0, 5.5), 0.3, 1.8)).toBe(false);
  });

  test("a slab collides below half height but not above it (partial-Y)", () => {
    const world = emptyWorld();
    world.set(5, 5, 5, BlockId.StoneSlab);
    // Feet inside the bottom half: collides.
    expect(collidesAt(world, new THREE.Vector3(5.5, 5.2, 5.5), 0.3, 1.8)).toBe(true);
    // Standing ON the slab's top face (y = 5.5): clear — this is what
    // auto-step-up lands on.
    expect(collidesAt(world, new THREE.Vector3(5.5, 5.5, 5.5), 0.3, 1.8)).toBe(false);
  });

  test("a stair collides per box: the raised back blocks only its half", () => {
    const world = emptyWorld();
    world.set(5, 5, 5, BlockId.StoneStairsSouth); // raised back on the +z half
    // At slab height over the LOW half (z < 5.5): clear.
    expect(collidesAt(world, new THREE.Vector3(5.2, 5.5, 5.2), 0.2, 1.8)).toBe(false);
    // At slab height over the HIGH half (z > 5.5): the back collides.
    expect(collidesAt(world, new THREE.Vector3(5.2, 5.5, 5.8), 0.2, 1.8)).toBe(true);
    // Standing on top of the high back (y = 6, the full-cube rule): clear.
    expect(collidesAt(world, new THREE.Vector3(5.2, 6.0, 5.8), 0.2, 1.8)).toBe(false);
  });

  test("a closed door blocks its opening while an open door leaves the center passable", () => {
    const world = emptyWorld();
    world.set(5, 5, 5, BlockId.DoorNorthLower);
    world.set(5, 6, 5, BlockId.DoorNorthUpper);
    const feet = new THREE.Vector3(5.5, 5, 5.5);
    expect(collidesAt(world, feet, 0.3, 1.8)).toBe(true);

    world.set(5, 5, 5, BlockId.DoorNorthOpenLower);
    world.set(5, 6, 5, BlockId.DoorNorthOpenUpper);
    expect(collidesAt(world, feet, 0.3, 1.8)).toBe(false);
  });
});

describe("hasSupportUnderPlayer", () => {
  test("detects solid ground directly below the feet", () => {
    const world = emptyWorld();
    world.set(5, 5, 5, BlockId.Stone);
    expect(hasSupportUnderPlayer(world, new THREE.Vector3(5.5, 6.0, 5.5), 0.3)).toBe(true);
  });

  test("no support over air or water", () => {
    const world = emptyWorld();
    world.set(5, 5, 5, BlockId.Water);
    expect(hasSupportUnderPlayer(world, new THREE.Vector3(5.5, 6.0, 5.5), 0.3)).toBe(false);
  });

  test("an edge overhang still counts when any corner has ground", () => {
    const world = emptyWorld();
    world.set(5, 5, 5, BlockId.Stone);
    expect(hasSupportUnderPlayer(world, new THREE.Vector3(6.2, 6.0, 5.5), 0.3)).toBe(true);
    expect(hasSupportUnderPlayer(world, new THREE.Vector3(7.4, 6.0, 5.5), 0.3)).toBe(false);
  });
});

describe("createSurfaceYAt", () => {
  test("returns one above the highest solid block", () => {
    const world = emptyWorld();
    world.set(5, 7, 5, BlockId.Stone);
    expect(createSurfaceYAt(world)(5.4, 5.9)).toBe(8);
  });

  test("returns 1 outside the world bounds", () => {
    const world = emptyWorld();
    expect(createSurfaceYAt(world)(-3, 5)).toBe(1);
    expect(createSurfaceYAt(world)(5, 99)).toBe(1);
  });
});
