import { describe, expect, test } from "bun:test";
import { BlockId } from "@/lib/world";
import { NETHER_GEN, collectFortressSites, generateNetherWorld } from "@/lib/world/netherGeneration";
import { VoxelWorld } from "@/lib/world/voxelWorld";
import { WORLDGEN_BASELINES } from "@/lib/world/generationBaselines";
import { createNetherFloorYAt } from "@/lib/game/spawn";

function hashBytes(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

function makeNether(sizeX: number, sizeY: number, sizeZ: number, seed: number): VoxelWorld {
  const world = new VoxelWorld(sizeX, sizeY, sizeZ, seed);
  generateNetherWorld(world);
  return world;
}

describe("nether worldgen determinism", () => {
  // The same contract as the overworld's: byte-identical output per (seed,
  // size) forever. A failure after a refactor means the refactor broke save
  // compatibility — fix the code, never the hash (re-baselining requires a
  // deliberate WORLDGEN_VERSION bump, which discards BOTH dimensions' diffs).
  test.each(Object.entries(WORLDGEN_BASELINES.nether.small128))("128³ nether world for seed %s matches its baseline", (seed, expected) => {
    expect(hashBytes(makeNether(128, 150, 128, Number(seed)).blocks)).toBe(expected);
  });

  test("full-size 512×150×512 nether world (seed 1337) matches its baseline", () => {
    expect(hashBytes(makeNether(512, 150, 512, 1337).blocks)).toBe(WORLDGEN_BASELINES.nether.full512Seed1337);
  });
});

describe("nether structural probes", () => {
  const world = makeNether(128, 150, 128, 1337);

  test("bedrock seals the floor AND the ceiling (the cap zeroes baked skylight)", () => {
    for (let x = 0; x < world.sizeX; x += 8) {
      for (let z = 0; z < world.sizeZ; z += 8) {
        expect(world.get(x, 0, z)).toBe(BlockId.Bedrock);
        expect(world.get(x, world.sizeY - 1, z)).toBe(BlockId.Bedrock);
      }
    }
  });

  test("lava seas exist at the flood line and no lava floats above it", () => {
    let lavaAtSea = 0;
    for (let y = 1; y < world.sizeY - 1; y += 1) {
      for (let z = 0; z < world.sizeZ; z += 4) {
        for (let x = 0; x < world.sizeX; x += 4) {
          if (world.get(x, y, z) !== BlockId.Lava) continue;
          expect(y).toBeLessThanOrEqual(NETHER_GEN.lavaSeaLevel);
          lavaAtSea += 1;
        }
      }
    }
    expect(lavaAtSea).toBeGreaterThan(50); // the seas are real, not a puddle
  });

  test("glowstone hangs from netherrack ceilings with open air below", () => {
    let clusters = 0;
    for (let y = 1; y < world.sizeY - 1; y += 1) {
      for (let z = 0; z < world.sizeZ; z += 1) {
        for (let x = 0; x < world.sizeX; x += 1) {
          if (world.get(x, y, z) !== BlockId.Glowstone) continue;
          clusters += 1;
          // Every cluster cell is anchored: itself or a neighbor touches a
          // ceiling above — netherrack caverns or a fortress's brick roof.
          const anchored =
            world.get(x, y + 1, z) === BlockId.Netherrack ||
            world.get(x, y + 1, z) === BlockId.NetherBrick ||
            world.get(x, y + 1, z) === BlockId.Glowstone ||
            world.get(x - 1, y, z) === BlockId.Glowstone ||
            world.get(x + 1, y, z) === BlockId.Glowstone;
          expect(anchored).toBe(true);
        }
      }
    }
    expect(clusters).toBeGreaterThan(10);
  });

  test("blazite ore exists, only in the deep band, embedded in the mass", () => {
    let veins = 0;
    for (let y = 1; y < world.sizeY - 1; y += 1) {
      for (let z = 0; z < world.sizeZ; z += 1) {
        for (let x = 0; x < world.sizeX; x += 1) {
          if (world.get(x, y, z) !== BlockId.BlaziteOre) continue;
          expect(y).toBeLessThanOrEqual(NETHER_GEN.blaziteMaxY);
          veins += 1;
        }
      }
    }
    expect(veins).toBeGreaterThan(20);
  });

  test("the caverns leave walkable, lava-free floor pockets (arrivals and spawns need them)", () => {
    const floorYAt = createNetherFloorYAt(world);
    let pockets = 0;
    for (let x = 8; x < world.sizeX - 8; x += 4) {
      for (let z = 8; z < world.sizeZ - 8; z += 4) {
        if (floorYAt(x, z) > 2) pockets += 1;
      }
    }
    expect(pockets).toBeGreaterThan(50);
  });

  test("a tiny (engine-test-sized) nether still generates pockets and caps", () => {
    const tiny = makeNether(64, 150, 64, 1337);
    const floorYAt = createNetherFloorYAt(tiny);
    let pockets = 0;
    for (let x = 6; x < tiny.sizeX - 6; x += 2) {
      for (let z = 6; z < tiny.sizeZ - 6; z += 2) {
        if (floorYAt(x, z) > 2) pockets += 1;
      }
    }
    expect(pockets).toBeGreaterThan(10);
    expect(tiny.get(10, tiny.sizeY - 1, 10)).toBe(BlockId.Bedrock);
  });
});

describe("nether fortresses", () => {
  const world = makeNether(128, 150, 128, 1337);
  const sites = collectFortressSites(world);

  test("at least one fortress stands in a 128³ world", () => {
    expect(sites.chestIndices.length).toBeGreaterThanOrEqual(1);
  });

  test("collectFortressSites re-derives the exact chest/spawner cells the build wrote", () => {
    // Derive is a pure replay: every derived index holds the fixture block…
    for (const idx of sites.chestIndices) expect(world.blocks[idx]).toBe(BlockId.Chest);
    for (const idx of sites.spawnerIndices) expect(world.blocks[idx]).toBe(BlockId.Spawner);
    // …and the census closes the loop: every chest and spawner in the whole
    // nether belongs to a fortress site (nothing else places either block).
    const chestSet = new Set(sites.chestIndices);
    const spawnerSet = new Set(sites.spawnerIndices);
    for (let i = 0; i < world.blocks.length; i += 1) {
      if (world.blocks[i] === BlockId.Chest) expect(chestSet.has(i)).toBe(true);
      if (world.blocks[i] === BlockId.Spawner) expect(spawnerSet.has(i)).toBe(true);
    }
  });

  test("derivation is deterministic (collect twice is identical)", () => {
    const again = collectFortressSites(world);
    expect(again.chestIndices).toEqual(sites.chestIndices);
    expect(again.spawnerIndices).toEqual(sites.spawnerIndices);
  });

  test("keep interiors are carved (air stands over every spawner)", () => {
    const layer = world.sizeX * world.sizeZ;
    for (const idx of sites.spawnerIndices) {
      expect(world.blocks[idx + layer]).toBe(BlockId.Air);
      expect(world.blocks[idx + layer * 2]).toBe(BlockId.Air);
    }
  });

  test("fortresses are built of nether brick around their fixtures", () => {
    const layer = world.sizeX * world.sizeZ;
    for (const idx of sites.chestIndices) {
      // The floor pad directly under every chest is fortress brick.
      expect(world.blocks[idx - layer]).toBe(BlockId.NetherBrick);
    }
  });
});
