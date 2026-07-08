import { WORLDGEN_BASELINES } from "@/lib/world/generationBaselines";
import { expect, test } from "./helpers";

/**
 * Cross-engine worldgen determinism: the same seed must generate byte-identical
 * worlds on every JS engine, because saves ship only seed + block diffs and a
 * multiplayer server (Bun) must agree with browser clients (V8) on the
 * generated baseline. generation.test.ts pins these digests under Bun/JSC;
 * this spec recomputes the full-size digest inside Chromium/V8 against the
 * same constants — if the two engines ever disagreed, lib/world/noise.ts
 * failed at its one job.
 */
// pauseOnBoot freezes the engine before its first step. Pausing from the test
// body is too late: the boot window (menus → first frames) simulates live, and
// a fresh seed-1337 world is NOT free of random-tickable blocks — worldgen
// leaves growable kelp stalks and cave-exposed dirt beside grass in
// tickRandomBlocks range of spawn, each one Math.random roll away from a
// single-block edit that would corrupt the digest.
test.use({ pauseOnBoot: true });

test("Chromium generates the same seed-1337 world bytes as the Bun baseline", async ({ gamePage }) => {
  // Guard the guard: prove no block edits happened before the hash, so a
  // digest mismatch can only ever mean cross-engine divergence.
  const editCount = await gamePage.evaluate(() => window.__monecraft!.engine.serialize().changes.length);
  expect(editCount, "no block edits before hashing").toBe(0);

  const digest = await gamePage.evaluate(async () => {
    // Copy: digest() wants a plain-ArrayBuffer view, and the copy pins the
    // bytes at one instant regardless of anything stepping afterwards.
    const blocks = new Uint8Array(window.__monecraft!.engine.state.world.blocks);
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", blocks));
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  });
  expect(digest).toBe(WORLDGEN_BASELINES.full512Seed1337);
});
