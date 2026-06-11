import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Hotbar from "@/components/game/Hotbar";
import { HOTBAR_SLOTS, INVENTORY_SLOTS } from "@/lib/game/config";
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

  test("shows item icons, stack counts, and the selected item name", () => {
    renderHotbar({ selectedSlot: 1 });
    expect(screen.getByAltText("Dirt")).toBeTruthy(); // sprite icon
    expect(screen.getByAltText("Wood Pickaxe")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy(); // dirt stack count
    expect(screen.getByText("Wood Pickaxe")).toBeTruthy(); // fading name above the bar
  });

  test("single items show no count and empty slots show no icon", () => {
    renderHotbar();
    expect(screen.queryByText("1")).toBeNull(); // pickaxe count hidden
    const buttons = screen.getAllByRole("button");
    expect(buttons[5].querySelector("img")).toBeNull(); // empty slot
  });

  test("clicking a slot selects it", async () => {
    const user = userEvent.setup();
    const props = renderHotbar();
    await user.click(screen.getAllByRole("button")[3]);
    expect(props.onSelectSlot).toHaveBeenCalledWith(3);
  });
});
