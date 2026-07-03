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
 * (WORLDGEN_VERSION bump). Last re-baseline: v10 → v11, the move to
 * bit-portable noise.
 */
export const WORLDGEN_BASELINES = {
  /** Full-size 512×150×512 default world, seed 1337 — the real save-compat surface. */
  full512Seed1337: "a1892258a5db6e01dc7365ab387439b6297fa2066d0013617a216ae578135f39",
  /** 128×150×128 default worlds per seed. */
  small128: {
    1337: "69c03ceb293969bc8cd1ba907887c2760ddd734b1de1ab835b9b5a220e935797",
    1: "f67d37d27cc26e9569cc7ee278fbd00f69cb0e56799be1d7cac0b13f28ec6780",
    999999937: "012f7a81cab64c254ce54b003d53c2fbadab47f4e245426f86943d990217a554"
  },
  /** 128×150×128 non-default world types, seed 1337 — each type is its own contract. */
  typed: {
    flat: "9e463186e6b5797c80a1d0b50b0f40e93c2ef2f353aadfab27e2171fc246d5d1",
    amplified: "9361234c1907d43d1551f79e3c35a8c7942419f57b66038feec6e5b2772259d8",
    islands: "ff1381ffa159aaf02491b55770e0ea513809e8c44b42f8505d5bd0cd7d6d4f1c"
  } satisfies Partial<Record<WorldType, string>>
} as const;
