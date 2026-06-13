import { describe, expect, test } from "bun:test";
import { BiomeId, BlockId, VoxelWorld, buildGeometryRegion, collectDungeonSites, generateWorld } from "@/lib/world";

/**
 * Worldgen determinism characterization tests.
 *
 * Saves store only the seed plus block-change deltas, so world generation must
 * produce byte-identical output for a given seed forever. These digests pin the
 * current generator output.
 *
 * If a test here fails after a refactor, THE REFACTOR BROKE SAVE COMPATIBILITY —
 * fix the code, never the hash. Re-baselining is only legitimate for a deliberate,
 * CHANGELOG-flagged worldgen change, or for a Bun/JSC engine bump (the noise
 * functions use Math.sin, whose exact results are engine-defined; CI pins the Bun
 * version for this reason — see docs/testing.md).
 */

function hashBytes(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

function makeWorld(sizeX: number, sizeY: number, sizeZ: number, seed: number): VoxelWorld {
  const world = new VoxelWorld(sizeX, sizeY, sizeZ, seed);
  generateWorld(world);
  return world;
}

let fullWorldCache: VoxelWorld | null = null;
function fullWorld(): VoxelWorld {
  fullWorldCache ??= makeWorld(512, 150, 512, 1337);
  return fullWorldCache;
}

describe("worldgen determinism", () => {
  test.each([
    [1337, "8621d825353b26bb455811a79c49a662b26263a04dc88bab2c23521cf72716da"],
    [1, "04b9288619397c4beba76ae2037b11b2b73394df1f20ee125cdbe0ac82f4a5e8"],
    [999999937, "6cc58e8a8cfb6978937da3b181e3d1f00b94245b7a8025947a0c4ca10879d065"]
  ])("128x150x128 world for seed %d is byte-identical", (seed, expected) => {
    expect(hashBytes(makeWorld(128, 150, 128, seed).blocks)).toBe(expected);
  });

  test(
    "full-size 512x150x512 world for seed 1337 is byte-identical (the real save-compat surface)",
    () => {
      expect(hashBytes(fullWorld().blocks)).toBe("0f6b871af063a53744f4e3bb561f6ece8183374b8347e88f1a71184679503ce9");
    },
    { timeout: 60000 }
  );

  // Probes that survive a legitimate re-baseline: they describe the shape of the
  // world rather than its exact bytes, and localize a failure when the hash differs.
  test("structural probes for seed 1337", () => {
    const world = fullWorld();

    // Bedrock floor everywhere and border walls up to y=14.
    expect(world.get(5, 0, 5)).toBe(BlockId.Bedrock);
    expect(world.get(300, 0, 300)).toBe(BlockId.Bedrock);
    expect(world.get(0, 10, 100)).toBe(BlockId.Bedrock);
    expect(world.get(511, 14, 200)).toBe(BlockId.Bedrock);
    expect(world.get(200, 14, 0)).toBe(BlockId.Bedrock);

    // Biome field samples.
    expect(world.getBiome(1, 1)).toBe(BiomeId.Forest);
    expect(world.getBiome(1, 277)).toBe(BiomeId.Desert);
    expect(world.getBiome(400, 100)).toBe(BiomeId.Mountains);

    // Terrain heights at sample columns ((64,64) tops out in a tree canopy).
    expect(world.highestSolidY(64, 64)).toBe(49);
    expect(world.highestSolidY(256, 256)).toBe(28);
    expect(world.highestSolidY(400, 100)).toBe(104);

    // Snow caps above the snow line.
    expect(world.get(400, 104, 100)).toBe(BlockId.Snow);

    // Sea-level fill: a column whose floor is below sea level holds water at y=43.
    expect(world.highestSolidY(1, 277)).toBe(30);
    expect(world.get(1, 43, 277)).toBe(BlockId.Water);
  });
});

describe("world content balance", () => {
  // These floors pin the world's playability, not its exact bytes: they catch
  // the degenerate-biome regression class (a whole map collapsing to 1-2
  // biomes left some worlds nearly woodless) and survive legitimate
  // re-baselines as long as the world still plays right.
  test(
    "every biome appears with real coverage on the seed-1337 map",
    () => {
      const world = fullWorld();
      const counts = new Map<BiomeId, number>();
      let samples = 0;
      for (let x = 0; x < world.sizeX; x += 4) {
        for (let z = 0; z < world.sizeZ; z += 4) {
          const biome = world.getBiome(x, z);
          counts.set(biome, (counts.get(biome) ?? 0) + 1);
          samples += 1;
        }
      }
      for (const biome of [BiomeId.Plains, BiomeId.Desert, BiomeId.Ocean, BiomeId.Forest, BiomeId.Mountains]) {
        expect((counts.get(biome) ?? 0) / samples).toBeGreaterThan(0.02);
      }
      expect((counts.get(BiomeId.Forest) ?? 0) / samples).toBeGreaterThan(0.1);
    },
    { timeout: 60000 }
  );

  test(
    "wood, snow, cacti, and beaches actually generate",
    () => {
      const world = fullWorld();
      let woodNearCenter = 0;
      let snow = 0;
      let cactus = 0;
      for (let x = 0; x < world.sizeX; x += 1) {
        for (let z = 0; z < world.sizeZ; z += 1) {
          const nearCenter = Math.hypot(x - world.sizeX / 2, z - world.sizeZ / 2) <= 90;
          for (let y = 0; y < world.sizeY; y += 1) {
            const block = world.get(x, y, z);
            if (block === BlockId.Wood && nearCenter) woodNearCenter += 1;
            else if (block === BlockId.Snow) snow += 1;
            else if (block === BlockId.Cactus) cactus += 1;
          }
        }
      }
      expect(woodNearCenter).toBeGreaterThan(100); // a player can find wood without travelling far
      expect(snow).toBeGreaterThan(500); // mountain snow caps exist
      expect(cactus).toBeGreaterThanOrEqual(5); // some dry desert grows cacti

      // At least one beach column: sand top at sea level on a non-desert/ocean
      // column with water beside it.
      let beachFound = false;
      search: for (let x = 1; x < world.sizeX - 1; x += 1) {
        for (let z = 1; z < world.sizeZ - 1; z += 1) {
          const biome = world.getBiome(x, z);
          if (biome === BiomeId.Desert || biome === BiomeId.Ocean) continue;
          const topY = world.highestSolidY(x, z);
          if (topY < 43 || topY > 44 || world.get(x, topY, z) !== BlockId.Sand) continue;
          if (world.get(x + 1, 43, z) === BlockId.Water || world.get(x - 1, 43, z) === BlockId.Water) {
            beachFound = true;
            break search;
          }
        }
      }
      expect(beachFound).toBe(true);
    },
    { timeout: 60000 }
  );
});

describe("dungeons", () => {
  test(
    "dungeons generate underground with chests, spawners, and mossy cobble, clear of spawn",
    () => {
      const world = fullWorld();
      const sites = collectDungeonSites(world);
      expect(sites.chestIndices.length).toBeGreaterThan(0);
      expect(sites.spawnerIndices.length).toBeGreaterThan(0);

      const chestSet = new Set(sites.chestIndices);
      const spawnerSet = new Set(sites.spawnerIndices);
      const cx = world.sizeX / 2;
      const cz = world.sizeZ / 2;

      let chests = 0;
      let spawners = 0;
      let mossy = 0;
      for (let x = 0; x < world.sizeX; x += 1) {
        for (let z = 0; z < world.sizeZ; z += 1) {
          for (let y = 0; y < world.sizeY; y += 1) {
            const block = world.get(x, y, z);
            if (block === BlockId.Chest) {
              chests += 1;
              // Every generated chest must be a known dungeon site — this is what
              // gates lazy loot fill, so a mismatch would mean re-rollable loot.
              expect(chestSet.has(world.index(x, y, z))).toBe(true);
              // No dungeon loot in the immediate spawn area.
              expect(Math.hypot(x - cx, z - cz)).toBeGreaterThanOrEqual(30);
            } else if (block === BlockId.Spawner) {
              spawners += 1;
              expect(spawnerSet.has(world.index(x, y, z))).toBe(true);
            } else if (block === BlockId.MossyCobblestone) {
              mossy += 1;
            }
          }
        }
      }
      expect(chests).toBeGreaterThan(0);
      expect(spawners).toBeGreaterThan(0);
      expect(mossy).toBeGreaterThan(0);
    },
    { timeout: 60000 }
  );
});

describe("meshing", () => {
  test(
    "geometry for a generated region is byte-identical",
    () => {
      const world = makeWorld(128, 150, 128, 1337);
      const geometry = buildGeometryRegion(world, 0, 127, 0, 127);
      const positions = geometry.getAttribute("position");
      expect(positions.count).toBe(1357176);
      expect(hashBytes(new Uint8Array((positions.array as Float32Array).buffer))).toBe("aee5f8b3be9fe85fe0e3598a4c215bc78d2b51fd58b921e335d65476c835275e");
    },
    { timeout: 60000 }
  );

  test("a lone block renders 6 faces (36 vertices)", () => {
    const world = new VoxelWorld(8, 8, 8, 1);
    world.set(3, 3, 3, BlockId.Stone);
    const geometry = buildGeometryRegion(world, 0, 7, 0, 7);
    expect(geometry.getAttribute("position").count).toBe(36);
  });

  test("two adjacent solid blocks cull their shared faces", () => {
    const world = new VoxelWorld(8, 8, 8, 1);
    world.set(3, 3, 3, BlockId.Stone);
    world.set(4, 3, 3, BlockId.Stone);
    const geometry = buildGeometryRegion(world, 0, 7, 0, 7);
    expect(geometry.getAttribute("position").count).toBe(60); // 10 faces, not 12
  });

  test("water-to-water faces are skipped, water-to-air faces are rendered", () => {
    const world = new VoxelWorld(8, 8, 8, 1);
    world.set(3, 3, 3, BlockId.Water);
    world.set(4, 3, 3, BlockId.Water);
    const geometry = buildGeometryRegion(world, 0, 7, 0, 7);
    expect(geometry.getAttribute("position").count).toBe(60); // 5 air-facing faces each
  });

  test("the water/solid boundary renders faces on both sides", () => {
    const world = new VoxelWorld(8, 8, 8, 1);
    world.set(3, 3, 3, BlockId.Stone);
    world.set(4, 3, 3, BlockId.Water);
    const geometry = buildGeometryRegion(world, 0, 7, 0, 7);
    expect(geometry.getAttribute("position").count).toBe(72); // all 6 faces of each
  });
});
