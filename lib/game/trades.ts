import type { Recipe } from "@/lib/game/types";

/**
 * Villager trade offers. A trade is just a station-gated recipe (`station:
 * "villager"`), so it flows through the same crafting machinery and recipe-book
 * UI as everything else — it is only craftable while a villager trade is open.
 *
 * The economy is two-sided: SELL offers turn gathered materials into emeralds
 * (the currency), BUY offers spend emeralds on goods. There is no per-trade use
 * cap yet — trading is bounded by what you can gather, which keeps it self-
 * limiting without any persisted villager state.
 */
export const TRADES: Recipe[] = [
  // ── Sell (materials → emeralds) ──
  { id: "trade_wheat", label: "6 Wheat -> 1 Emerald", cost: [{ slotId: "wheat", count: 6 }], result: { slotId: "emerald", count: 1 }, station: "villager" },
  { id: "trade_coal", label: "3 Coal -> 1 Emerald", cost: [{ slotId: "coal", count: 3 }], result: { slotId: "emerald", count: 1 }, station: "villager" },
  {
    id: "trade_leather",
    label: "2 Leather -> 1 Emerald",
    cost: [{ slotId: "leather", count: 2 }],
    result: { slotId: "emerald", count: 1 },
    station: "villager"
  },
  {
    id: "trade_gold",
    label: "1 Gold Ore -> 1 Emerald",
    cost: [{ slotId: "gold_ore", count: 1 }],
    result: { slotId: "emerald", count: 1 },
    station: "villager"
  },
  // ── Buy (emeralds → goods) ──
  { id: "trade_bread", label: "1 Emerald -> 2 Bread", cost: [{ slotId: "emerald", count: 1 }], result: { slotId: "bread", count: 2 }, station: "villager" },
  { id: "trade_torch", label: "1 Emerald -> 8 Torch", cost: [{ slotId: "emerald", count: 1 }], result: { slotId: "torch", count: 8 }, station: "villager" },
  { id: "trade_arrows", label: "2 Emerald -> 8 Arrow", cost: [{ slotId: "emerald", count: 2 }], result: { slotId: "arrow", count: 8 }, station: "villager" },
  {
    id: "trade_pickaxe",
    label: "3 Emerald -> Stone Pickaxe",
    cost: [{ slotId: "emerald", count: 3 }],
    result: { slotId: "stone_pickaxe", count: 1 },
    station: "villager"
  },
  {
    id: "trade_sliver",
    label: "5 Emerald -> 1 Sliver Ore",
    cost: [{ slotId: "emerald", count: 5 }],
    result: { slotId: "sliver_ore", count: 1 },
    station: "villager"
  },
  { id: "trade_ruby", label: "8 Emerald -> 1 Ruby Ore", cost: [{ slotId: "emerald", count: 8 }], result: { slotId: "ruby_ore", count: 1 }, station: "villager" }
];
