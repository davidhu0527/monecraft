import { describe, expect, test } from "bun:test";
import {
  BiomeId,
  BlockId,
  VoxelWorld,
  buildGeometryLayersRegion,
  buildGeometryRegion,
  collectDungeonSites,
  collectVillageSites,
  computeFullLight,
  generateWorld,
  type WorldType
} from "@/lib/world";
import { GEN } from "@/lib/world/generation";

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

function makeTypedWorld(sizeX: number, sizeY: number, sizeZ: number, seed: number, worldType: WorldType): VoxelWorld {
  const world = new VoxelWorld(sizeX, sizeY, sizeZ, seed);
  generateWorld(world, worldType);
  return world;
}

const GROUND_BLOCKS = new Set<number>([BlockId.Grass, BlockId.Sand, BlockId.Dirt, BlockId.Stone, BlockId.Cobblestone, BlockId.Snow]);

/** Highest terrain (ground) block in a column, ignoring trees/water/air — the visible surface. */
function groundHeight(world: VoxelWorld, x: number, z: number): number {
  for (let y = world.sizeY - 1; y >= 0; y -= 1) {
    if (GROUND_BLOCKS.has(world.get(x, y, z))) return y;
  }
  return 0;
}

let fullWorldCache: VoxelWorld | null = null;
function fullWorld(): VoxelWorld {
  fullWorldCache ??= makeWorld(512, 150, 512, 1337);
  return fullWorldCache;
}

describe("worldgen determinism", () => {
  test.each([
    [1337, "b68e443c2baf43ddb0d522e595a2c66dc5b23f5fc06c25ebae2af07812525f25"],
    [1, "9af01515475054435df4789163f088c3362f594789629f6c326bed53576961f8"],
    [999999937, "a17c2e5610b7eb9dbfd6c5952d15e81b968b07e9a22adb9667b6fe5249004852"]
  ])("128x150x128 world for seed %d is byte-identical", (seed, expected) => {
    expect(hashBytes(makeWorld(128, 150, 128, seed).blocks)).toBe(expected);
  });

  test(
    "full-size 512x150x512 world for seed 1337 is byte-identical (the real save-compat surface)",
    () => {
      expect(hashBytes(fullWorld().blocks)).toBe("48bf16c8019ef76bb9b034942f88542a88785538d29c09bf6100f8a30d0831f2");
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

    // Lava pools in the deepest caves only — present, and never above lavaLevel.
    let lavaCells = 0;
    let maxLavaY = -1;
    const layer = world.sizeX * world.sizeZ;
    for (let i = 0; i < world.blocks.length; i += 1) {
      if (world.blocks[i] === BlockId.Lava) {
        lavaCells += 1;
        const ly = Math.floor(i / layer);
        if (ly > maxLavaY) maxLavaY = ly;
      }
    }
    expect(lavaCells).toBeGreaterThan(0);
    expect(maxLavaY).toBeLessThanOrEqual(9); // GEN.lavaLevel
  });
});

describe("world types", () => {
  // Each non-default type is its own save contract — pin its bytes so a future
  // refactor can't silently corrupt worlds created with it. Re-baseline only on
  // a deliberate, CHANGELOG-flagged change to that type (same policy as default).
  test.each([
    ["flat", "28e1e3ea69e01b02b8452f27bf88acc8a7b81edcfe24a4293363553379d072d3"],
    ["amplified", "87ff8cb4f73247a6e62bfc7c8638c86cfa7cfe8a5d90185d6773d390067540a0"],
    ["islands", "e9937c0d947a0952130c79c46c26fc37c9492c7d164e2dc61a626ea9d7d8a662"]
  ] as Array<[WorldType, string]>)("128x150x128 %s world for seed 1337 is byte-identical", (worldType, expected) => {
    expect(hashBytes(makeTypedWorld(128, 150, 128, 1337, worldType).blocks)).toBe(expected);
  });

  test("flat is nearly level; amplified has more relief than default", () => {
    const flat = makeTypedWorld(128, 150, 128, 1337, "flat");
    const def = makeTypedWorld(128, 150, 128, 1337, "default");
    const amp = makeTypedWorld(128, 150, 128, 1337, "amplified");

    // Fraction of columns whose ground surface sits exactly at the flat height,
    // and the overall height spread. (Caves nibble the surface — denser in this
    // small test world than at full size — so flat isn't perfectly uniform, but
    // it concentrates at y=48 far more than the varied default terrain does.)
    const flatTarget = 48;
    const stats = (w: VoxelWorld) => {
      let lo = Infinity;
      let hi = -Infinity;
      let atTarget = 0;
      let total = 0;
      for (let x = 8; x < w.sizeX - 8; x += 4) {
        for (let z = 8; z < w.sizeZ - 8; z += 4) {
          const h = groundHeight(w, x, z);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
          if (h === flatTarget) atTarget += 1;
          total += 1;
        }
      }
      return { range: hi - lo, fracAtTarget: atTarget / total };
    };

    const f = stats(flat);
    const d = stats(def);
    const a = stats(amp);

    expect(f.fracAtTarget).toBeGreaterThan(0.4); // flat ground concentrates at y=48
    expect(f.fracAtTarget).toBeGreaterThan(d.fracAtTarget * 3); // far more than default's spread terrain
    expect(d.range).toBeGreaterThan(30); // default terrain spans a wide height band
    expect(a.range).toBeGreaterThan(d.range); // amplified is more dramatic still
  });

  test("islands floods more of the map than default but still leaves dry land above the sea", () => {
    const islands = makeTypedWorld(128, 150, 128, 1337, "islands");
    const def = makeTypedWorld(128, 150, 128, 1337, "default");
    const ISLANDS_SEA = 54;

    const waterColumns = (w: VoxelWorld, sea: number) => {
      let wet = 0;
      let total = 0;
      for (let x = 8; x < w.sizeX - 8; x += 4) {
        for (let z = 8; z < w.sizeZ - 8; z += 4) {
          total += 1;
          if (groundHeight(w, x, z) < sea) wet += 1;
        }
      }
      return wet / total;
    };

    expect(waterColumns(islands, ISLANDS_SEA)).toBeGreaterThan(waterColumns(def, 43));
    expect(waterColumns(islands, ISLANDS_SEA)).toBeGreaterThan(0.2);

    // Dry, standable land above the sea exists (so the spawn search has somewhere to land).
    let dryLand = 0;
    for (let x = 8; x < islands.sizeX - 8; x += 2) {
      for (let z = 8; z < islands.sizeZ - 8; z += 2) {
        const h = groundHeight(islands, x, z);
        if (h > ISLANDS_SEA && islands.get(x, h + 1, z) === BlockId.Air) dryLand += 1;
      }
    }
    expect(dryLand).toBeGreaterThan(50);
  });

  test("dungeons follow the type's terrain (no floating dungeons in a flat world)", () => {
    // Regression: dungeon depths use terrainTopY, which must read the type's
    // config — not GEN — or a mountain-biome column's default height would carve
    // a dungeon high above the flat surface (y=48).
    const flat = makeTypedWorld(128, 150, 128, 1337, "flat");
    let spawners = 0;
    let maxSpawnerY = -1;
    const layer = flat.sizeX * flat.sizeZ;
    for (let i = 0; i < flat.blocks.length; i += 1) {
      if (flat.blocks[i] === BlockId.Spawner) {
        spawners += 1;
        maxSpawnerY = Math.max(maxSpawnerY, Math.floor(i / layer));
      }
    }
    expect(spawners).toBeGreaterThan(0); // dungeons still generate
    expect(maxSpawnerY).toBeLessThan(48); // every spawner sits below the flat surface
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

  test(
    "coal is the most common ore and reaches shallower than the rare ores",
    () => {
      const world = fullWorld();
      const layer = world.sizeX * world.sizeZ;
      let coal = 0;
      let sliver = 0;
      let diamond = 0;
      let maxCoalY = -1;
      let maxDiamondY = -1;
      for (let i = 0; i < world.blocks.length; i += 1) {
        const b = world.blocks[i];
        if (b === BlockId.CoalOre) {
          coal += 1;
          const y = Math.floor(i / layer);
          if (y > maxCoalY) maxCoalY = y;
        } else if (b === BlockId.SliverOre) {
          sliver += 1;
        } else if (b === BlockId.DiamondOre) {
          diamond += 1;
          const y = Math.floor(i / layer);
          if (y > maxDiamondY) maxDiamondY = y;
        }
      }
      expect(coal).toBeGreaterThan(sliver); // coal is the staple early-game ore
      expect(coal).toBeGreaterThan(diamond * 4);
      // Coal veins can sit higher (closer to the surface) than the deep ores.
      expect(maxCoalY).toBeGreaterThan(maxDiamondY);
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

describe("villages", () => {
  test(
    "villages build house clusters on flat land clear of spawn, and collectVillageSites reproduces their centers",
    () => {
      const world = fullWorld();
      const sites = collectVillageSites(world);
      expect(sites.centers.length).toBeGreaterThan(0); // seed 1337 yields at least one village

      // The derive is deterministic — a second pass produces identical centers.
      expect(collectVillageSites(world)).toEqual(sites);

      const cx = world.sizeX / 2;
      const cz = world.sizeZ / 2;
      for (const center of sites.centers) {
        expect(Math.hypot(center.x - cx, center.z - cz)).toBeGreaterThanOrEqual(GEN.villageMinSpawnDistance);
        // A house actually stands at the site: brick walls within the footprint.
        let brick = 0;
        for (let x = center.x - 14; x <= center.x + 14; x += 1) {
          for (let z = center.z - 14; z <= center.z + 14; z += 1) {
            for (let y = 0; y < world.sizeY; y += 1) {
              if (world.inBounds(x, y, z) && world.get(x, y, z) === BlockId.Brick) brick += 1;
            }
          }
        }
        expect(brick).toBeGreaterThan(0);
      }
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
      expect(positions.count).toBe(1319472);
      expect(hashBytes(new Uint8Array((positions.array as Float32Array).buffer))).toBe("b63ca724cc91653c76a01c45980f56cf3bfd2987ab61bc6e0f4fe2de6b7e529b");
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

  test("a two-block door meshes as two thin cuboids", () => {
    const world = new VoxelWorld(8, 8, 8, 1);
    world.set(3, 3, 3, BlockId.DoorNorthLower);
    world.set(3, 4, 3, BlockId.DoorNorthUpper);
    const geometry = buildGeometryRegion(world, 0, 7, 0, 7);
    const positions = geometry.getAttribute("position");
    expect(positions.count).toBe(72);
    expect(geometry.boundingBox).toBeNull();
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.z).toBeCloseTo(3.40625);
    expect(geometry.boundingBox!.max.z).toBeCloseTo(3.59375);
    expect(geometry.boundingBox!.max.y - geometry.boundingBox!.min.y).toBe(2);
  });

  test("the mesh carries a per-vertex aLight attribute sampled from the faced voxel", () => {
    const world = new VoxelWorld(8, 8, 8, 1);
    world.set(3, 3, 3, BlockId.Stone);
    world.light = computeFullLight(world);
    const geometry = buildGeometryRegion(world, 0, 7, 0, 7);
    const aLight = geometry.getAttribute("aLight");
    expect(aLight.itemSize).toBe(2);
    expect(aLight.count).toBe(geometry.getAttribute("position").count);
    // Every visible face of the lone block opens into open-sky air, so its
    // skyExposure (aLight.x) is lit, and nothing emits block light (aLight.y = 0).
    let minSky = 1;
    let maxBlock = 0;
    for (let i = 0; i < aLight.count; i += 1) {
      minSky = Math.min(minSky, aLight.getX(i));
      maxBlock = Math.max(maxBlock, aLight.getY(i));
    }
    expect(minSky).toBeGreaterThan(0.9);
    expect(maxBlock).toBe(0);
  });
});
