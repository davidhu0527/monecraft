import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import EnchantingColumn from "./EnchantingColumn";
import { createSlot } from "@/lib/game/items";

describe("EnchantingColumn", () => {
  test("prompts to select an item when none is enchantable", () => {
    render(<EnchantingColumn item={undefined} xpLevel={10} cost={3} onEnchant={() => {}} />);
    expect(screen.getByText(/Select a tool/)).toBeTruthy();
  });

  test("lists only the enchants applicable to the held item's kind", () => {
    render(<EnchantingColumn item={createSlot("diamond_sword", 1)} xpLevel={10} cost={3} onEnchant={() => {}} />);
    // A weapon gets Sharpness + Unbreaking, not Efficiency or Protection.
    expect(screen.getByRole("button", { name: /Sharpness/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Unbreaking/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Efficiency/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Protection/ })).toBeNull();
  });

  test("disables enchant buttons when the cost is unaffordable", () => {
    render(<EnchantingColumn item={createSlot("diamond_pickaxe", 1)} xpLevel={1} cost={3} onEnchant={() => {}} />);
    expect((screen.getByRole("button", { name: /Efficiency/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
