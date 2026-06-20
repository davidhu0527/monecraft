import { describe, expect, test } from "bun:test";
import { XP_PER_LEVEL } from "@/lib/game/config";
import { BlockId } from "@/lib/world";
import { MOB_XP, xpForMob } from "@/lib/game/mobXp";
import { awardXp, spendXpLevels, xpForBlock, xpLevel, xpProgress } from "@/lib/game/engine/systems/xp";
import type { GameEvent, GameState } from "@/lib/game/engine/state";
import type { MobKind } from "@/lib/game/types";

function makeState(xp = 0): GameState {
  return { xp } as unknown as GameState;
}

describe("xp levels & progress", () => {
  test("level is floor(points / XP_PER_LEVEL) and progress is the remainder fraction", () => {
    expect(xpLevel(0)).toBe(0);
    expect(xpLevel(XP_PER_LEVEL - 1)).toBe(0);
    expect(xpLevel(XP_PER_LEVEL)).toBe(1);
    expect(xpLevel(XP_PER_LEVEL * 3 + 4)).toBe(3);
    expect(xpProgress(0)).toBe(0);
    expect(xpProgress(XP_PER_LEVEL / 2)).toBeCloseTo(0.5, 5);
    expect(xpProgress(XP_PER_LEVEL)).toBe(0);
  });
});

describe("awardXp", () => {
  test("banks points and emits xpGained, ignoring non-positive amounts", () => {
    const state = makeState();
    const events: GameEvent[] = [];
    const emit = (e: GameEvent) => events.push(e);

    awardXp(state, 5, emit);
    awardXp(state, 3, emit);
    expect(state.xp).toBe(8);
    expect(events).toEqual([
      { type: "xpGained", amount: 5 },
      { type: "xpGained", amount: 3 }
    ]);

    awardXp(state, 0, emit);
    awardXp(state, -10, emit);
    expect(state.xp).toBe(8); // unchanged
    expect(events).toHaveLength(2); // no extra events
  });
});

describe("spendXpLevels", () => {
  test("spends whole levels when affordable and refuses (unchanged) when too poor", () => {
    const state = makeState(XP_PER_LEVEL * 5 + 4); // level 5 + partial progress
    expect(spendXpLevels(state, 3)).toBe(true);
    expect(state.xp).toBe(XP_PER_LEVEL * 2 + 4); // 3 levels gone, partial progress kept
    expect(xpLevel(state.xp)).toBe(2);

    expect(spendXpLevels(state, 9)).toBe(false); // can't afford
    expect(state.xp).toBe(XP_PER_LEVEL * 2 + 4); // unchanged

    expect(spendXpLevels(state, 0)).toBe(true); // free is always affordable
  });
});

describe("xp source tables", () => {
  test("ore blocks grant XP, non-ore blocks grant none", () => {
    expect(xpForBlock(BlockId.DiamondOre)).toBeGreaterThan(0);
    expect(xpForBlock(BlockId.CoalOre)).toBeGreaterThan(0);
    expect(xpForBlock(BlockId.Stone)).toBe(0);
    expect(xpForBlock(BlockId.Dirt)).toBe(0);
    // Rarer ores are worth more than common coal.
    expect(xpForBlock(BlockId.DiamondOre)).toBeGreaterThan(xpForBlock(BlockId.CoalOre));
  });

  test("every mob kind has an XP value; hostiles beat passives and the boss is a jackpot", () => {
    const kinds: MobKind[] = ["sheep", "chicken", "horse", "cow", "pig", "villager", "zombie", "skeleton", "spider", "creeper", "boss"];
    for (const kind of kinds) expect(typeof xpForMob(kind)).toBe("number");
    expect(MOB_XP.villager).toBe(0);
    expect(MOB_XP.zombie).toBeGreaterThan(MOB_XP.sheep);
    expect(MOB_XP.boss).toBeGreaterThan(MOB_XP.zombie * 10);
  });
});
