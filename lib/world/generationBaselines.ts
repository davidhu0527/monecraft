import type { WorldType } from "./worldTypes";

/**
 * SHA-256 digests of generated world block bytes — the save-compat contract.
 *
 * Saves store only the seed plus block-change deltas, so generateWorld() must
 * produce byte-identical output for a given seed forever. generation.test.ts
 * pins these on Bun, and e2e/determinism.e2e.ts recomputes the full-size digest
 * inside Chromium against the same constants — proving worldgen is
 * engine-portable (the property lib/world/noise.ts exists to guarantee, and
 * that multiplayer world sync relies on).
 *
 * If a test against these fails after a refactor, THE REFACTOR BROKE SAVE
 * COMPATIBILITY — fix the code, never the hash. Re-baselining is only
 * legitimate for a deliberate, CHANGELOG-flagged worldgen change
 * (WORLDGEN_VERSION bump). Last re-baseline: v11 → v12, deep redstone ore
 * (the overworld digests) and nether fortresses (the nether digests).
 */
export const WORLDGEN_BASELINES = {
  /** Full-size 512×150×512 default world, seed 1337 — the real save-compat surface. */
  full512Seed1337: "c9727ee8c9300ec233e517bfe35d786ae4e2d49036ac2411cffa7e2fbe57adda",
  /** 128×150×128 default worlds per seed. */
  small128: {
    1337: "6f3db24900b8a1b7b4bfb5ad2a3e76ba1216e71bc103182b86e65868216de16e",
    1: "fb8c256978a54ad8ca604a17955a04e40726c913dcbc5b0be4a0df0a64409fb1",
    999999937: "5607005d1f8af064fa135f2545d43a566f27262d31f43505ebe25399531b5ddd"
  },
  /** 128×150×128 non-default world types, seed 1337 — each type is its own contract. */
  typed: {
    flat: "45dc6e00ff1d9b852d473a050b0c9354cb1f29bb2198aee6bf2479859a5d3e88",
    amplified: "0a724b0294a994c6173b12d0dca67fb0e0e643ee990d8dfaa88b9db3eb54127c",
    islands: "e586b15f8a0c6103ae0dc8037be54e14522740ab63ec32cbbb238d0015c662d6"
  } satisfies Partial<Record<WorldType, string>>,
  /**
   * The nether (lib/world/netherGeneration.ts) — its own byte contract under
   * the SAME WORLDGEN_VERSION stamp (a bump discards both dimensions' diffs).
   * The generator scales carve/vein counts by area, so each size is its own
   * surface. Baselined at introduction (worldgen v11 era).
   */
  nether: {
    /** Full-size 512×150×512, seed 1337 — the real save-compat surface. */
    full512Seed1337: "dc77fbde804522f80ebb66b722d07fcdefddf3033944d0081e73da9f4aaf3fa2",
    /** 128×150×128 per seed. */
    small128: {
      1337: "90829a3a4f8cf0f45fae1168f43b8d3f5c75780f2be977985d7ceac082372051",
      1: "04963e7ee60d70b300a53eaf1cec12d6db376f544aa288e49fc039bf0de1fe38",
      999999937: "73d3423d696655623a6dccf7214d28d14d2936e1ac74067f196a3d00c1678625"
    }
  }
} as const;
