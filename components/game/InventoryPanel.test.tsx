import { describe, expect, mock, test } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InventoryPanel from "@/components/game/InventoryPanel";
import { HOTBAR_SLOTS, INVENTORY_SLOTS } from "@/lib/game/config";
import { createEmptyArmorEquipment, createEmptySlot, createSlot } from "@/lib/game/items";
import { RECIPES } from "@/lib/game/recipes";
import type { InventorySlot } from "@/lib/game/types";

function makeInventory(...items: Array<[string, number] | null>): InventorySlot[] {
  const slots = Array.from({ length: INVENTORY_SLOTS }, () => createEmptySlot());
  items.forEach((item, i) => {
    if (item) slots[i] = createSlot(item[0], item[1]);
  });
  return slots;
}

function renderPanel(overrides: Partial<Parameters<typeof InventoryPanel>[0]> = {}) {
  const props = {
    inventory: makeInventory(["dirt", 10], ["stone", 5], ["helmet", 1]),
    equippedArmor: createEmptyArmorEquipment(),
    selectedHotbarSlot: 0,
    hotbarSlots: HOTBAR_SLOTS,
    recipes: RECIPES,
    canCraft: () => true,
    onSwapSlots: mock(),
    onToggleEquipArmor: mock(),
    onCraft: mock(),
    ...overrides
  };
  render(<InventoryPanel {...props} />);
  return props;
}

function slotButtons() {
  // Slot buttons render "Empty" or an item label; recipe buttons live in .crafting-list.
  return screen.getAllByRole("button").filter((button) => button.className.includes("inventory-slot"));
}

describe("InventoryPanel", () => {
  test("renders all inventory slots plus recipe buttons", () => {
    renderPanel();
    expect(slotButtons()).toHaveLength(INVENTORY_SLOTS);
    expect(screen.getByText("2 Wood -> 4 Planks")).toBeTruthy();
  });

  test("clicking two slots swaps them via onSwapSlots", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    const slots = slotButtons();

    await user.click(slots[0]); // pending
    expect(slots[0].className).toContain("pending");
    await user.click(slots[1]);
    expect(props.onSwapSlots).toHaveBeenCalledWith(0, 1);
  });

  test("clicking the same slot twice cancels the pending selection", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    const slots = slotButtons();

    await user.click(slots[0]);
    await user.click(slots[0]);
    expect(slots[0].className).not.toContain("pending");
    expect(props.onSwapSlots).not.toHaveBeenCalled();

    await user.click(slots[1]); // a fresh click starts a new pending selection
    expect(props.onSwapSlots).not.toHaveBeenCalled();
  });

  test("clicking an armor item toggles equipment instead of swapping", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    const slots = slotButtons();

    await user.click(slots[2]); // the helmet
    expect(props.onToggleEquipArmor).toHaveBeenCalledWith(2);
    expect(props.onSwapSlots).not.toHaveBeenCalled();
  });

  test("equipped armor is shown in its armor slot with durability", () => {
    renderPanel({ equippedArmor: { ...createEmptyArmorEquipment(), helmet: "helmet" } });
    const helmetSlot = screen.getByText("Helmet", { selector: ".armor-slot-name" }).closest(".armor-slot")!;
    expect(helmetSlot.className).toContain("filled");
    expect(within(helmetSlot as HTMLElement).getByText("260/260")).toBeTruthy();
  });

  test("craft buttons are disabled per canCraft and click through onCraft", async () => {
    const user = userEvent.setup();
    const planks = RECIPES.find((recipe) => recipe.id === "planks")!;
    const props = renderPanel({ canCraft: (recipe) => recipe.id === "planks" });

    const planksButton = screen.getByText(planks.label) as HTMLButtonElement;
    const glassButton = screen.getByText("4 Sand -> 2 Glass") as HTMLButtonElement;
    expect(planksButton.disabled).toBe(false);
    expect(glassButton.disabled).toBe(true);

    await user.click(planksButton);
    expect(props.onCraft).toHaveBeenCalledWith(planks);
  });
});
