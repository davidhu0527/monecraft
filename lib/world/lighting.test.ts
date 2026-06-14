import { beforeEach, describe, expect, test } from "bun:test";
import { BlockId, VoxelWorld } from "@/lib/world";
import { applyEdit, blockLightAt, computeFullLight, emission, isLightBlocker, opacity } from "./lighting";

function airWorld(size = 24): VoxelWorld {
  return new VoxelWorld(size, size, size, 1);
}

function solidWorld(size = 24): VoxelWorld {
  const world = new VoxelWorld(size, size, size, 1);
  world.blocks.fill(BlockId.Stone);
  return world;
}

function sky(world: VoxelWorld, light: Uint8Array, x: number, y: number, z: number): number {
  return light[world.index(x, y, z)] >> 4;
}

function block(world: VoxelWorld, light: Uint8Array, x: number, y: number, z: number): number {
  return blockLightAt(light, world.index(x, y, z));
}

describe("light classification", () => {
  test("air and glass are fully transparent", () => {
    expect(opacity(BlockId.Air)).toBe(0);
    expect(opacity(BlockId.Glass)).toBe(0);
    expect(isLightBlocker(BlockId.Air)).toBe(false);
    expect(isLightBlocker(BlockId.Glass)).toBe(false);
  });

  test("water and leaves attenuate but transmit", () => {
    expect(opacity(BlockId.Water)).toBe(1);
    expect(opacity(BlockId.Leaves)).toBe(1);
    expect(isLightBlocker(BlockId.Water)).toBe(false);
    expect(isLightBlocker(BlockId.Leaves)).toBe(false);
  });

  test("solid blocks fully block light", () => {
    expect(isLightBlocker(BlockId.Stone)).toBe(true);
    expect(isLightBlocker(BlockId.Dirt)).toBe(true);
    expect(isLightBlocker(BlockId.Bedrock)).toBe(true);
  });

  test("torches and lava emit block light; ordinary blocks do not", () => {
    expect(emission(BlockId.Torch)).toBe(14);
    expect(emission(BlockId.Lava)).toBe(15);
    expect(emission(BlockId.Air)).toBe(0);
    expect(emission(BlockId.Stone)).toBe(0);
    expect(emission(BlockId.Glass)).toBe(0);
  });

  test("lava blocks sky light (it is opaque) while still emitting", () => {
    expect(isLightBlocker(BlockId.Lava)).toBe(true);
  });
});

describe("block light", () => {
  test("a torch emits block light that decays one level per step", () => {
    const world = airWorld(40);
    world.set(12, 12, 12, BlockId.Torch);
    const light = computeFullLight(world);
    expect(block(world, light, 12, 12, 12)).toBe(14); // the emitter cell
    expect(block(world, light, 13, 12, 12)).toBe(13); // one step out
    expect(block(world, light, 15, 12, 12)).toBe(11); // three steps out
    expect(block(world, light, 26, 12, 12)).toBe(0); // beyond range
  });

  test("placing a torch lights a dark pocket, mining it lets the dark return", () => {
    const world = solidWorld(24);
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dz = -2; dz <= 2; dz += 1) world.set(12 + dx, 12 + dy, 12 + dz, BlockId.Air);
      }
    }
    const light = computeFullLight(world);
    expect(block(world, light, 13, 12, 12)).toBe(0); // sealed pocket, no light

    world.set(12, 12, 12, BlockId.Torch);
    applyEdit(world, light, 12, 12, 12);
    expect(block(world, light, 12, 12, 12)).toBe(14);
    expect(block(world, light, 13, 12, 12)).toBe(13);

    world.set(12, 12, 12, BlockId.Air);
    applyEdit(world, light, 12, 12, 12);
    expect(block(world, light, 13, 12, 12)).toBe(0); // torch gone, dark again
  });

  test("lava emits the brightest block light from an opaque source cell", () => {
    const world = airWorld(40);
    world.set(12, 12, 12, BlockId.Lava);
    const light = computeFullLight(world);
    expect(block(world, light, 12, 12, 12)).toBe(15); // the molten cell itself
    expect(block(world, light, 13, 12, 12)).toBe(14); // radiates into the air beside it
    expect(block(world, light, 16, 12, 12)).toBe(11);
  });
});

describe("skylight bake", () => {
  test("an open world is fully lit top to bottom", () => {
    const world = airWorld();
    const light = computeFullLight(world);
    expect(sky(world, light, 5, 23, 5)).toBe(15);
    expect(sky(world, light, 5, 12, 5)).toBe(15);
    expect(sky(world, light, 5, 0, 5)).toBe(15);
  });

  test("sunlight falls straight down for free but stops under an opaque cap", () => {
    const world = airWorld();
    // A single 1x1 stone cap deep enough that no horizontal bleed reaches the
    // column far below it: surround the column with a sealed stone shaft.
    for (let y = 0; y < 24; y += 1) {
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ]) {
        world.set(12 + dx, y, 12 + dz, BlockId.Stone);
      }
    }
    world.set(12, 18, 12, BlockId.Stone); // cap the shaft
    const light = computeFullLight(world);
    expect(sky(world, light, 12, 19, 12)).toBe(15); // above the cap: open sky
    expect(sky(world, light, 12, 17, 12)).toBe(0); // sealed below the cap: dark
    expect(sky(world, light, 12, 5, 12)).toBe(0);
  });

  test("deep inside a large solid mass is pitch dark", () => {
    const world = solidWorld(40);
    // carve nothing — a fully solid block has no interior light
    const light = computeFullLight(world);
    expect(sky(world, light, 20, 20, 20)).toBe(0);
    expect(block(world, light, 20, 20, 20)).toBe(0);
  });

  test("skylight bleeds sideways into an overhang", () => {
    // Solid world with a horizontal tunnel open at one end; cells near the mouth
    // are lit by horizontal bleed, cells deep in are dark.
    const world = solidWorld(40);
    const y = 20;
    const z = 20;
    for (let x = 20; x < 40; x += 1) world.set(x, y, z, BlockId.Air); // tunnel to the +x open face
    // Open the mouth to the sky-lit exterior by clearing the column at x=39.
    for (let yy = y; yy < 40; yy += 1) world.set(39, yy, z, BlockId.Air);
    const light = computeFullLight(world);
    expect(sky(world, light, 39, y, z)).toBe(15); // open mouth
    expect(sky(world, light, 36, y, z)).toBeGreaterThan(0); // a few blocks in: bleed
    expect(sky(world, light, 36, y, z)).toBeLessThan(15);
    expect(sky(world, light, 22, y, z)).toBe(0); // deep in the tunnel: dark
  });

  test("water attenuates skylight with depth", () => {
    const world = airWorld(24);
    for (let y = 0; y <= 18; y += 1) {
      for (let x = 0; x < 24; x += 1) for (let z = 0; z < 24; z += 1) world.set(x, y, z, BlockId.Water);
    }
    const light = computeFullLight(world);
    const top = sky(world, light, 12, 18, 12);
    const mid = sky(world, light, 12, 14, 12);
    const deep = sky(world, light, 12, 10, 12);
    expect(top).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(deep);
  });
});

describe("incremental relight (applyEdit)", () => {
  let world: VoxelWorld;
  let light: Uint8Array;

  beforeEach(() => {
    // A sealed vertical shaft in solid rock: open column at (12,*,12) down to y=5.
    world = solidWorld(40);
    for (let y = 39; y >= 5; y -= 1) world.set(12, y, 12, BlockId.Air);
    light = computeFullLight(world);
  });

  test("the open shaft starts lit, the rock around it dark", () => {
    expect(sky(world, light, 12, 10, 12)).toBe(15);
    expect(sky(world, light, 14, 10, 12)).toBe(0);
  });

  test("capping the shaft plunges it into darkness", () => {
    world.set(12, 30, 12, BlockId.Stone);
    applyEdit(world, light, 12, 30, 12);
    expect(sky(world, light, 12, 10, 12)).toBe(0);
  });

  test("re-opening a capped shaft floods light back in", () => {
    world.set(12, 30, 12, BlockId.Stone);
    applyEdit(world, light, 12, 30, 12);
    expect(sky(world, light, 12, 10, 12)).toBe(0);

    world.set(12, 30, 12, BlockId.Air);
    applyEdit(world, light, 12, 30, 12);
    expect(sky(world, light, 12, 10, 12)).toBe(15);
  });

  test("mining a side room off the shaft lights it from the shaft", () => {
    world.set(13, 10, 12, BlockId.Air);
    applyEdit(world, light, 13, 10, 12);
    // adjacent to a 15 cell, through air: 15 - 1 = 14
    expect(sky(world, light, 13, 10, 12)).toBe(14);
  });

  test("a bounded edit matches a full rebake everywhere (box-rebake correctness)", () => {
    // Capping the shaft is the worst case: it darkens a tall column far beyond
    // the box's vertical radius, which the full-height column recompute must
    // handle. Compare the ENTIRE light field against a fresh bake — any cell the
    // box missed would diverge.
    world.set(12, 30, 12, BlockId.Stone);
    applyEdit(world, light, 12, 30, 12);
    const fresh = computeFullLight(world);
    expect(light).toEqual(fresh);
  });

  test("a deep side edit also matches a full rebake everywhere", () => {
    world.set(13, 8, 12, BlockId.Air); // open a side pocket off the shaft
    applyEdit(world, light, 13, 8, 12);
    expect(light).toEqual(computeFullLight(world));
  });

  test("a long sequence of varied edits stays byte-identical to a full rebake", () => {
    // Deterministic PRNG so the sequence is fixed; each edit places or mines a
    // block somewhere in/around the shaft, and the incremental field must match
    // a from-scratch bake after every single edit.
    let seed = 0x9e3779b9;
    const rand = () => {
      seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 1) >>> 0;
      return seed / 0x100000000;
    };
    const palette = [BlockId.Air, BlockId.Stone, BlockId.Glass, BlockId.Water, BlockId.Leaves];
    for (let i = 0; i < 60; i += 1) {
      const x = 8 + Math.floor(rand() * 9);
      const y = 4 + Math.floor(rand() * 32);
      const z = 8 + Math.floor(rand() * 9);
      world.set(x, y, z, palette[Math.floor(rand() * palette.length)]);
      applyEdit(world, light, x, y, z);
      expect(light).toEqual(computeFullLight(world));
    }
  });
});
