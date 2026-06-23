import { describe, expect, test } from "bun:test";
import {
  canEditBlocks,
  canFly,
  canInteract,
  freeBuild,
  GAME_MODE_IDS,
  GAME_MODE_PRESETS,
  isGameMode,
  isNoclip,
  mobsThreaten,
  takesDamage,
  usesInventory,
  type GameMode
} from "./gameModes";

describe("isGameMode", () => {
  test("accepts the four modes and rejects everything else", () => {
    for (const id of GAME_MODE_IDS) expect(isGameMode(id)).toBe(true);
    for (const bad of ["", "Survival", "peaceful", "hardcore", null, undefined, 3, {}]) {
      expect(isGameMode(bad)).toBe(false);
    }
  });
});

describe("presets", () => {
  test("cover exactly the four modes, in id order", () => {
    expect(GAME_MODE_PRESETS.map((p) => p.id)).toEqual([...GAME_MODE_IDS]);
  });
});

describe("predicates", () => {
  // The full intent table — each row is the source of truth for one mode's gates.
  const table: Record<
    GameMode,
    { damage: boolean; edit: boolean; free: boolean; interact: boolean; fly: boolean; noclip: boolean; inv: boolean; threat: boolean }
  > = {
    survival: { damage: true, edit: true, free: false, interact: true, fly: false, noclip: false, inv: true, threat: true },
    creative: { damage: false, edit: true, free: true, interact: true, fly: true, noclip: false, inv: true, threat: false },
    adventure: { damage: true, edit: false, free: false, interact: true, fly: false, noclip: false, inv: true, threat: true },
    spectator: { damage: false, edit: false, free: false, interact: false, fly: true, noclip: true, inv: false, threat: false }
  };

  for (const mode of GAME_MODE_IDS) {
    test(`${mode} predicates`, () => {
      const row = table[mode];
      expect(takesDamage(mode)).toBe(row.damage);
      expect(canEditBlocks(mode)).toBe(row.edit);
      expect(freeBuild(mode)).toBe(row.free);
      expect(canInteract(mode)).toBe(row.interact);
      expect(canFly(mode)).toBe(row.fly);
      expect(isNoclip(mode)).toBe(row.noclip);
      expect(usesInventory(mode)).toBe(row.inv);
      expect(mobsThreaten(mode)).toBe(row.threat);
    });
  }
});
