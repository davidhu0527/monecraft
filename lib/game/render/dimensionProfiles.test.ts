import { describe, expect, test } from "bun:test";
import { DIMENSION_PROFILES } from "@/lib/game/render/dimensionProfiles";

describe("dimension profiles", () => {
  test("every dimension has a coherent profile (the Record is compile-enforced; sanity-check the dials)", () => {
    for (const profile of Object.values(DIMENSION_PROFILES)) {
      expect(profile.fogNear).toBeLessThan(profile.fogFar);
      expect(profile.skyLightFloor).toBeGreaterThanOrEqual(0);
      expect(profile.skyLightFloor).toBeLessThan(1);
    }
  });

  test("the nether is skyless, rainless, closer-fogged, and brighter-floored than the overworld", () => {
    const over = DIMENSION_PROFILES.overworld;
    const nether = DIMENSION_PROFILES.nether;
    expect(over.celestials).toBe(true);
    expect(nether.celestials).toBe(false);
    expect(nether.precipitation).toBe(false);
    expect(nether.fogFar).toBeLessThan(over.fogFar);
    // No sky light ever reaches nether terrain — the raised floor IS its ambience.
    expect(nether.skyLightFloor).toBeGreaterThan(over.skyLightFloor);
  });
});
