import { describe, expect, test } from "bun:test";
import { DEFAULT_PLAYER_PALETTE, DEFAULT_SKIN_ID, getSkinPreset, isSkinId, SKIN_PRESETS } from "./playerSkins";

describe("skin presets", () => {
  test("ships six presets with unique ids and labels", () => {
    expect(SKIN_PRESETS).toHaveLength(6);
    expect(new Set(SKIN_PRESETS.map((preset) => preset.id)).size).toBe(6);
    expect(new Set(SKIN_PRESETS.map((preset) => preset.label)).size).toBe(6);
  });

  test("every palette field is a valid 24-bit color", () => {
    for (const preset of SKIN_PRESETS) {
      for (const value of Object.values(preset.palette)) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(0xffffff);
      }
    }
  });

  test("the default preset is first and backs DEFAULT_PLAYER_PALETTE", () => {
    expect(SKIN_PRESETS[0].id).toBe(DEFAULT_SKIN_ID);
    expect(DEFAULT_PLAYER_PALETTE).toBe(SKIN_PRESETS[0].palette);
  });

  test("getSkinPreset resolves known ids and falls back to default", () => {
    expect(getSkinPreset("robot").id).toBe("robot");
    expect(getSkinPreset("nope").id).toBe(DEFAULT_SKIN_ID);
    expect(getSkinPreset("").id).toBe(DEFAULT_SKIN_ID);
  });

  test("isSkinId guards arbitrary values", () => {
    expect(isSkinId("knight")).toBe(true);
    expect(isSkinId("herobrine")).toBe(false);
    expect(isSkinId(42)).toBe(false);
    expect(isSkinId(undefined)).toBe(false);
  });
});
