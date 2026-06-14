import { describe, expect, test } from "bun:test";
import { BOSS_HP, HOSTILE_MOB_HP } from "@/lib/game/config";
import { MOB_TEMPLATES } from "@/lib/game/mobs";

describe("mob templates", () => {
  test("ordinary hostile mobs have 100 HP and the boss has 1000 HP", () => {
    for (const kind of ["zombie", "skeleton", "spider", "creeper"] as const) {
      expect(MOB_TEMPLATES[kind].hp).toBe(HOSTILE_MOB_HP);
    }
    expect(HOSTILE_MOB_HP).toBe(100);
    expect(MOB_TEMPLATES.boss.hp).toBe(BOSS_HP);
    expect(BOSS_HP).toBe(1000);
  });
});
