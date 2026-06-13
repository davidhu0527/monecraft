import { describe, expect, test } from "bun:test";
import { BiomeId, BlockId, VoxelWorld, buildGeometryLayersRegion, buildGeometryRegion, generateWorld } from "@/lib/world";

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
    [1337, "b5fdbdb52db110be4d963c2eb30ae5678ac46dd8c3ca63baccf98b464059d5c3"],
    [1, "4ff7cf20eabc45506c83314afa370f8f09107b1f6a9a93865fb10681c8b8456d"],
    [999999937, "ac9e6f83a447e9194a230ef6f771db8da7173ebd291244b1cd10196ab903b109"]
  ])("128x150x128 world for seed %d is byte-identical", (seed, expected) => {
    expect(hashBytes(makeWorld(128, 150, 128, seed).blocks)).toBe(expected);
  });

  test(
    "full-size 512x150x512 world for seed 1337 is byte-identical (the real save-compat surface)",
    () => {
      expect(hashBytes(fullWorld().blocks)).toBe("788cb3a2952929975d18d11a47e789d324f7df76be47912a0b4221b07ad88b58");
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

describe("meshing", () => {
  test(
    "geometry for a generated region is byte-identical",
    () => {
      const world = makeWorld(128, 150, 128, 1337);
      const geometry = buildGeometryRegion(world, 0, 127, 0, 127);
      const positions = geometry.getAttribute("position");
      expect(positions.count).toBe(1342776);
      expect(hashBytes(new Uint8Array((positions.array as Float32Array).buffer))).toBe("2e86e767dc462d7770538409b2faab359cfc82e2978205ff94dcf34a4fd187cb");
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

  test("glass is split into a clear layer and keeps adjacent opaque faces visible", () => {
    const world = new VoxelWorld(8, 8, 8, 1);
    world.set(3, 3, 3, BlockId.Stone);
    world.set(4, 3, 3, BlockId.Glass);
    world.set(5, 3, 3, BlockId.Glass);
    const geometry = buildGeometryLayersRegion(world, 0, 7, 0, 7);

    expect(geometry.opaque.getAttribute("position").count).toBe(36);
    expect(geometry.glass.getAttribute("position").count).toBe(60);
  });
});
