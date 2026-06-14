import { describe, expect, test } from "bun:test";
import { createEmptySlot, createSlot, ITEM_DEF_BY_ID } from "@/lib/game/items";
import { canCraft, countsById, craft } from "@/lib/game/inventory";
import { TRADES } from "@/lib/game/trades";
import type { InventorySlot } from "@/lib/game/types";

function inventory(items: Array<[string, number]>): InventorySlot[] {
  const slots = Array.from({ length: 12 }, () => createEmptySlot());
  items.forEach(([id, count], i) => {
    slots[i] = createSlot(id, count);
  });
  return slots;
}

const trade = (id: string) => {
  const found = TRADES.find((t) => t.id === id);
  if (!found) throw new Error(`trade ${id} not found`);
  return found;
};

describe("villager trades", () => {
  test("every trade is a villager-station offer over real items", () => {
    for (const t of TRADES) {
      expect(t.station).toBe("villager");
      for (const cost of t.cost) expect(ITEM_DEF_BY_ID[cost.slotId], `${t.id} cost ${cost.slotId}`).toBeDefined();
      expect(ITEM_DEF_BY_ID[t.result.slotId], `${t.id} result ${t.result.slotId}`).toBeDefined();
    }
  });

  test("the economy is two-sided: some trades pay emeralds, some spend them", () => {
    const earns = TRADES.filter((t) => t.result.slotId === "emerald");
    const spends = TRADES.filter((t) => t.cost.some((c) => c.slotId === "emerald"));
    expect(earns.length).toBeGreaterThan(0);
    expect(spends.length).toBeGreaterThan(0);
  });

  test("selling materials yields an emerald", () => {
    const slots = inventory([["wheat", 6]]);
    const t = trade("trade_wheat");
    expect(canCraft(slots, t)).toBe(true);
    expect(countsById(craft(slots, t)!).get("emerald")).toBe(1);
  });

  test("spending an emerald buys goods", () => {
    const slots = inventory([["emerald", 1]]);
    const t = trade("trade_bread");
    expect(canCraft(slots, t)).toBe(true);
    const next = craft(slots, t)!;
    expect(countsById(next).get("bread")).toBe(2);
    expect(countsById(next).get("emerald")).toBeUndefined(); // spent
  });

  test("a trade you can't afford is not craftable", () => {
    expect(canCraft(inventory([["emerald", 4]]), trade("trade_ruby"))).toBe(false); // needs 8
  });
});
