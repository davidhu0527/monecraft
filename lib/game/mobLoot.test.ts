import { describe, expect, test } from "bun:test";
import { LOOTING_BONUS_PER_LEVEL } from "@/lib/game/config";
import { ITEM_DEF_BY_ID } from "@/lib/game/items";
import { MOB_DROPS, rollMobDrops } from "@/lib/game/mobLoot";
import type { MobKind } from "@/lib/game/types";

// Derived from the table so new mob kinds are covered automatically.
const ALL_KINDS = Object.keys(MOB_DROPS) as MobKind[];

describe("mob drop tables", () => {
  test("every drop references an existing item", () => {
    for (const kind of ALL_KINDS) {
      for (const entry of MOB_DROPS[kind]) {
        expect(ITEM_DEF_BY_ID[entry.itemId]).toBeDefined();
        expect(entry.min).toBeLessThanOrEqual(entry.max);
        expect(entry.min).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("rng at 0 yields the minimum count of each guaranteed entry", () => {
    // rng() === 0 takes any chance entry and floors the count to its minimum.
    const drops = rollMobDrops("sheep", () => 0);
    const byId = new Map(drops.map((d) => [d.itemId, d.count]));
    expect(byId.get("wool")).toBe(1); // min 1
    expect(byId.get("raw_mutton")).toBe(1); // min 1
  });

  test("rng near 1 yields the maximum count", () => {
    const rng = () => 0.999;
    const drops = rollMobDrops("sheep", rng);
    const byId = new Map(drops.map((d) => [d.itemId, d.count]));
    expect(byId.get("wool")).toBe(2); // max 2
    expect(byId.get("raw_mutton")).toBe(1);
  });

  test("a zero-minimum entry can drop nothing at the low roll", () => {
    // chicken feather is min 0; at rng 0 the count floors to 0 and is omitted.
    const drops = rollMobDrops("chicken", () => 0);
    expect(drops.some((d) => d.itemId === "feather")).toBe(false);
    expect(drops.some((d) => d.itemId === "raw_chicken")).toBe(true);
  });

  test("Looting adds a bonus count to each dropped entry", () => {
    const rng = () => 0.999; // max base count, then max looting bonus
    const base = new Map(rollMobDrops("sheep", rng).map((d) => [d.itemId, d.count]));
    const looted = new Map(rollMobDrops("sheep", rng, 2).map((d) => [d.itemId, d.count]));
    // Base sheep: wool 2 (max), mutton 1. Looting 2 adds floor(0.999 × (2×1 + 1)) = 2 to each.
    expect(base.get("wool")).toBe(2);
    expect(base.get("raw_mutton")).toBe(1);
    expect(looted.get("wool")).toBe(2 + 2 * LOOTING_BONUS_PER_LEVEL);
    expect(looted.get("raw_mutton")).toBe(1 + 2 * LOOTING_BONUS_PER_LEVEL);
  });

  test("Looting level 0 is identical to no Looting (back-compat default)", () => {
    const seq = [0.2, 0.7, 0.4, 0.9];
    const make = () => {
      let i = 0;
      return () => seq[i++ % seq.length];
    };
    expect(rollMobDrops("cow", make(), 0)).toEqual(rollMobDrops("cow", make()));
  });

  test("every combat mob has at least one drop entry (villagers are NPCs and drop nothing)", () => {
    for (const kind of ALL_KINDS) {
      if (kind === "villager") {
        expect(MOB_DROPS[kind]).toHaveLength(0); // intentional: don't reward killing a trader
        continue;
      }
      expect(MOB_DROPS[kind].length).toBeGreaterThan(0);
    }
  });
});
