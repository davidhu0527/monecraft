import { describe, expect, test } from "bun:test";
import { BlockId } from "@/lib/world";
import { recordEvent, recordTick, STATS } from "@/lib/game/engine/systems/advancements";
import type { GameEvent, GameState } from "@/lib/game/engine/state";

// recordEvent / recordTick only ever touch `state.stats`, so a bare stub is all
// the unit needs — no engine, world, or Three.js.
function freshState(): GameState {
  return { stats: new Map<string, number>() } as unknown as GameState;
}

function record(state: GameState, ...events: GameEvent[]): void {
  for (const event of events) recordEvent(state, event);
}

describe("recordEvent — block mining", () => {
  test("every break bumps the blocks_mined total", () => {
    const state = freshState();
    record(state, { type: "blockBroken", blockId: BlockId.Dirt, x: 0, y: 0, z: 0 });
    expect(state.stats.get("blocks_mined")).toBe(1);
    // A plain block has no targeted counter.
    expect(state.stats.get("logs_chopped")).toBeUndefined();
  });

  test("a log bumps logs_chopped alongside the total", () => {
    const state = freshState();
    record(state, { type: "blockBroken", blockId: BlockId.Wood, x: 0, y: 0, z: 0 });
    expect(state.stats.get("blocks_mined")).toBe(1);
    expect(state.stats.get("logs_chopped")).toBe(1);
  });

  test("ores bump their per-ore counter", () => {
    const state = freshState();
    record(
      state,
      { type: "blockBroken", blockId: BlockId.SliverOre, x: 0, y: 0, z: 0 },
      { type: "blockBroken", blockId: BlockId.DiamondOre, x: 0, y: 0, z: 0 }
    );
    expect(state.stats.get("sliver_ore_mined")).toBe(1);
    expect(state.stats.get("diamond_ore_mined")).toBe(1);
    expect(state.stats.get("blocks_mined")).toBe(2);
  });

  test("harvesting mature wheat bumps wheat_harvested (immature stages do not)", () => {
    const state = freshState();
    record(
      state,
      { type: "blockBroken", blockId: BlockId.WheatStage1, x: 0, y: 0, z: 0 },
      { type: "blockBroken", blockId: BlockId.WheatStage3, x: 0, y: 0, z: 0 }
    );
    expect(state.stats.get("wheat_harvested")).toBe(1);
  });
});

describe("recordEvent — combat & mobs", () => {
  test("killing a hostile bumps hostiles_killed; a passive animal does not", () => {
    const state = freshState();
    record(state, { type: "mobDied", kind: "zombie", x: 0, y: 0, z: 0 }, { type: "mobDied", kind: "sheep", x: 0, y: 0, z: 0 });
    expect(state.stats.get("hostiles_killed")).toBe(1);
  });

  test("the boss counts as a hostile kill", () => {
    const state = freshState();
    record(state, { type: "mobDied", kind: "boss", x: 0, y: 0, z: 0 });
    expect(state.stats.get("hostiles_killed")).toBe(1);
  });

  test("breeding, firing, and the boss kill each have their own counter", () => {
    const state = freshState();
    record(state, { type: "mobBred", kind: "cow" }, { type: "bowFired" }, { type: "bossDefeated", x: 0, y: 0, z: 0 });
    expect(state.stats.get("animals_bred")).toBe(1);
    expect(state.stats.get("arrows_fired")).toBe(1);
    expect(state.stats.get("boss_defeated")).toBe(1);
  });
});

describe("recordEvent — crafting", () => {
  test("any pickaxe recipe bumps the aggregate pickaxes_crafted", () => {
    const state = freshState();
    record(state, { type: "crafted", recipeId: "stone_pickaxe" });
    expect(state.stats.get("items_crafted")).toBe(1);
    expect(state.stats.get("pickaxes_crafted")).toBe(1);
    expect(state.stats.get("crafted_stone_pickaxe")).toBe(1);
    expect(state.stats.get("villager_trades")).toBeUndefined();
  });

  test("the furnace recipe drives crafted_furnace but not pickaxes_crafted", () => {
    const state = freshState();
    record(state, { type: "crafted", recipeId: "furnace" });
    expect(state.stats.get("crafted_furnace")).toBe(1);
    expect(state.stats.get("pickaxes_crafted")).toBeUndefined();
  });

  test("a villager trade bumps villager_trades", () => {
    const state = freshState();
    record(state, { type: "crafted", recipeId: "trade_wheat" });
    expect(state.stats.get("items_crafted")).toBe(1);
    expect(state.stats.get("villager_trades")).toBe(1);
  });

  test("an unknown recipe id records nothing", () => {
    const state = freshState();
    record(state, { type: "crafted", recipeId: "not_a_recipe" });
    expect(state.stats.size).toBe(0);
  });
});

describe("recordEvent — system events & accumulation", () => {
  test("each tracked event maps to its counter", () => {
    const state = freshState();
    record(
      state,
      { type: "enchanted", enchant: "sharpness" },
      { type: "drankPotion" },
      { type: "fishingCaught", items: [], x: 0, y: 0, z: 0 },
      { type: "sleepStarted" },
      { type: "died" },
      { type: "jumped" }
    );
    expect(state.stats.get("items_enchanted")).toBe(1);
    expect(state.stats.get("potions_drunk")).toBe(1);
    expect(state.stats.get("fish_caught")).toBe(1);
    expect(state.stats.get("sleeps")).toBe(1);
    expect(state.stats.get("deaths")).toBe(1);
    expect(state.stats.get("jumps")).toBe(1);
  });

  test("counters accumulate across repeated events", () => {
    const state = freshState();
    record(state, { type: "jumped" }, { type: "jumped" }, { type: "jumped" });
    expect(state.stats.get("jumps")).toBe(3);
  });

  test("irrelevant events record nothing", () => {
    const state = freshState();
    record(state, { type: "blockPlaced", blockId: BlockId.Dirt, x: 0, y: 0, z: 0 }, { type: "attackSwung" });
    expect(state.stats.size).toBe(0);
  });
});

describe("recordTick", () => {
  test("accumulates play time and distance travelled", () => {
    const state = freshState();
    recordTick(state, 0.5, 1.25);
    recordTick(state, 0.5, 0.75);
    expect(state.stats.get("play_time")).toBe(1);
    expect(state.stats.get("distance_walked")).toBe(2);
  });
});

describe("STATS metadata", () => {
  test("the displayed stat ids are unique", () => {
    const ids = STATS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
