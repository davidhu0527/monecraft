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

  test("the boss is a last resort, only for its trophy drops", () => {
    expect(itemSourceHint("dragon_heart")).toBe("Defeat the boss");
  });

  test("an unknown item has no hint", () => {
    expect(itemSourceHint("definitely_not_an_item")).toBeNull();
  });
});
