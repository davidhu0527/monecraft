import { describe, expect, test } from "bun:test";
import { itemSourceHint } from "@/lib/game/itemSources";

describe("itemSourceHint", () => {
  test("hunting a common mob is preferred for its drops", () => {
    expect(itemSourceHint("wool")).toBe("Hunt a sheep"); // beats the craft-from-string path
    expect(itemSourceHint("bone")).toBe("Hunt a skeleton");
    expect(itemSourceHint("gunpowder")).toBe("Hunt a creeper");
  });

  test("craftable items report the right station verb", () => {
    expect(itemSourceHint("planks")).toBe("Craft it");
    expect(itemSourceHint("glass")).toBe("Craft it");
    expect(itemSourceHint("emerald")).toBe("Trade for it"); // villager station
  });

  test("mined blocks and ores say to mine them", () => {
    expect(itemSourceHint("stone")).toBe("Mine Stone");
    expect(itemSourceHint("diamond_ore")).toBe("Mine Diamond Ore"); // boss also drops it, but mining wins
    expect(itemSourceHint("coal")).toBe("Mine coal ore"); // override: item differs from the block
  });

  test("raw fish points at hunting cod now that fish mobs swim the oceans", () => {
    // Hunt-first priority: cod drop raw fish, which beats the fishing fallback
    // (every FISHING_LOOT item now has an earlier-priority source).
    expect(itemSourceHint("raw_fish")).toBe("Hunt a cod");
  });

  test("the treasure map points at diving shipwrecks, its main source", () => {
    // Shipwreck chests outrank the fishing fallback (the map is also a rare catch).
    expect(itemSourceHint("treasure_map")).toBe("Find it in a shipwreck");
  });

  test("the boss is a last resort, only for its trophy drops", () => {
    expect(itemSourceHint("dragon_heart")).toBe("Defeat the boss");
  });

  test("an unknown item has no hint", () => {
    expect(itemSourceHint("definitely_not_an_item")).toBeNull();
  });
});

describe("chance-gated drops never hint", () => {
  test("the drowned's lucky extras keep their natural sources", () => {
    // The drowned drops a sliver spear at 7% and kelp at 50% — lucky extras,
    // not the items' repeatable sources. Craft/mine hints must win.
    expect(itemSourceHint("sliver_spear")).toBe("Craft it");
    expect(itemSourceHint("kelp")).not.toBe("Hunt a drowned");
    // Its guaranteed drop hints normally (the drowned precedes the zombie in
    // MOB_DROPS order, and the first source set for an item wins).
    expect(itemSourceHint("rotten_flesh")).toBe("Hunt a drowned");
  });
});
