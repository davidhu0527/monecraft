import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Hotbar from "@/components/game/Hotbar";
import { HOTBAR_SLOTS, INVENTORY_SLOTS, MAX_HUNGER, MAX_HEARTS } from "@/lib/game/config";
import { createEmptySlot, createSlot } from "@/lib/game/items";
import type { InventorySlot } from "@/lib/game/types";

function makeInventory(): InventorySlot[] {
  const slots = Array.from({ length: INVENTORY_SLOTS }, () => createEmptySlot());
  slots[0] = createSlot("dirt", 12);
  slots[1] = createSlot("wood_pickaxe", 1);
  return slots;
}

function renderHotbar(overrides: Partial<Parameters<typeof Hotbar>[0]> = {}) {
  const props = {
    inventory: makeInventory(),
    selectedSlot: 0,
    hotbarSlots: HOTBAR_SLOTS,
    hearts: 40,
    maxHearts: MAX_HEARTS,
    hunger: 80,
    maxHunger: MAX_HUNGER,
    onSelectSlot: mock(),
    ...overrides
  };
  render(<Hotbar {...props} />);
  return props;
}

describe("Hotbar", () => {
  test("renders one button per hotbar slot with the selected one active", () => {
    renderHotbar({ selectedSlot: 1 });
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(HOTBAR_SLOTS);
    expect(buttons[1].className).toContain("active");
    expect(buttons[0].className).not.toContain("active");
  });

  test("shows item labels, counts, durability, and the selected chip", () => {
    renderHotbar({ selectedSlot: 1 });
    expect(screen.getByText("12")).toBeTruthy(); // dirt count
    expect(screen.getByText("70/70")).toBeTruthy(); // pickaxe durability
    expect(screen.getByText("Selected: Wood Pickaxe")).toBeTruthy();
    expect(screen.getByText("40/50")).toBeTruthy(); // health
    expect(screen.getByText("80/100")).toBeTruthy(); // hunger
  });

  test("clicking a slot selects it", async () => {
    const user = userEvent.setup();
    const props = renderHotbar();
    await user.click(screen.getAllByRole("button")[3]);
    expect(props.onSelectSlot).toHaveBeenCalledWith(3);
  });
});
