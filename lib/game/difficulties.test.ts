import { describe, expect, test } from "bun:test";
import { MAX_HEARTS } from "@/lib/game/config";
import {
  DIFFICULTY_IDS,
  DIFFICULTY_PRESETS,
  hostileCapScale,
  hostileSpawnIntervalScale,
  hostilesSpawn,
  isDifficulty,
  mobDamageMultiplier,
  regenIntervalScale,
  starvationFloorHp,
  starves,
  type Difficulty
} from "./difficulties";

describe("isDifficulty", () => {
  test("accepts the four levels and rejects everything else", () => {
    for (const id of DIFFICULTY_IDS) expect(isDifficulty(id)).toBe(true);
    for (const bad of ["", "Peaceful", "survival", "hardcore", null, undefined, 2, {}]) {
      expect(isDifficulty(bad)).toBe(false);
    }
  });
});

describe("presets", () => {
  test("cover exactly the four levels, in id order", () => {
    expect(DIFFICULTY_PRESETS.map((p) => p.id)).toEqual([...DIFFICULTY_IDS]);
  });
});

describe("accessors", () => {
  // The full intent table — each row is the source of truth for one level's tuning.
  const table: Record<Difficulty, { spawn: boolean; dmg: number; interval: number; cap: number; regen: number; starves: boolean; floor: number }> = {
    peaceful: { spawn: false, dmg: 0, interval: 1, cap: 0, regen: 0.5, starves: false, floor: MAX_HEARTS },
    easy: { spawn: true, dmg: 0.5, interval: 1.5, cap: 0.5, regen: 1, starves: true, floor: 10 },
    normal: { spawn: true, dmg: 1, interval: 1, cap: 1, regen: 1, starves: true, floor: 1 },
    hard: { spawn: true, dmg: 1.5, interval: 0.6, cap: 1.5, regen: 1, starves: true, floor: 0 }
  };

  for (const difficulty of DIFFICULTY_IDS) {
    test(`${difficulty} accessors`, () => {
      const row = table[difficulty];
      expect(hostilesSpawn(difficulty)).toBe(row.spawn);
      expect(mobDamageMultiplier(difficulty)).toBe(row.dmg);
      expect(hostileSpawnIntervalScale(difficulty)).toBe(row.interval);
      expect(hostileCapScale(difficulty)).toBe(row.cap);
      expect(regenIntervalScale(difficulty)).toBe(row.regen);
      expect(starves(difficulty)).toBe(row.starves);
      expect(starvationFloorHp(difficulty)).toBe(row.floor);
    });
  }
});
