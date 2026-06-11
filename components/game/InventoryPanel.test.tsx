import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
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
  // Inventory slot wells, excluding the armor column and recipe entries.
  return screen.getAllByRole("button").filter((button) => button.className.includes("inv-slot") && !button.className.includes("armor-slot"));
}

describe("InventoryPanel", () => {
  test("renders all inventory slots plus recipe buttons", () => {
    renderPanel();
    expect(slotButtons()).toHaveLength(INVENTORY_SLOTS);
    expect(screen.getByRole("button", { name: "2 Wood -> 4 Planks" })).toBeTruthy();
  });

  test("slots are ordered storage first, hotbar row last, with icons and counts", () => {
    renderPanel();
    const slots = slotButtons();
    // DOM order: the 27 storage slots (indices 9..35) render above the hotbar row (0..8).
    expect(slots[27].getAttribute("aria-label")).toBe("Slot 1: Dirt");
    // Dirt appears as the slot icon and again inside recipe ingredients.
    expect(screen.getAllByAltText("Dirt").length).toBeGreaterThan(0);
    expect(screen.getByText("10")).toBeTruthy(); // the dirt stack count
  });

  test("clicking two slots swaps them via onSwapSlots", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    const slots = slotButtons();

    await user.click(slots[0]); // pending — first storage slot, inventory index 9
    expect(slots[0].className).toContain("pending");
    await user.click(slots[1]);
    expect(props.onSwapSlots).toHaveBeenCalledWith(9, 10);
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

    await user.click(slots[27 + 2]); // the helmet sits in hotbar slot 2
    expect(props.onToggleEquipArmor).toHaveBeenCalledWith(2);
    expect(props.onSwapSlots).not.toHaveBeenCalled();
  });

  test("equipped armor is shown in its armor slot with durability and unequips on click", async () => {
    const user = userEvent.setup();
    const props = renderPanel({ equippedArmor: { ...createEmptyArmorEquipment(), helmet: "helmet" } });
    const helmetSlot = screen.getByRole("button", { name: "Helmet: Helmet" });
    expect(helmetSlot.className).toContain("filled");
    expect(helmetSlot.getAttribute("title")).toBe("Helmet (260/260)");
    await user.click(helmetSlot);
    expect(props.onToggleEquipArmor).toHaveBeenCalledWith(2); // the helmet's inventory index
  });

  test("empty armor slots show a ghost icon and ignore clicks", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    const bootsSlot = screen.getByRole("button", { name: "Boots: empty" });
    await user.click(bootsSlot);
    expect(props.onToggleEquipArmor).not.toHaveBeenCalled();
  });

  test("craft buttons are disabled per canCraft and click through onCraft", async () => {
    const user = userEvent.setup();
    const planks = RECIPES.find((recipe) => recipe.id === "planks")!;
    const props = renderPanel({ canCraft: (recipe) => recipe.id === "planks" });

    const planksButton = screen.getByRole("button", { name: planks.label }) as HTMLButtonElement;
    const glassButton = screen.getByRole("button", { name: "4 Sand -> 2 Glass" }) as HTMLButtonElement;
    expect(planksButton.disabled).toBe(false);
    expect(glassButton.disabled).toBe(true);

    await user.click(planksButton);
    expect(props.onCraft).toHaveBeenCalledWith(planks);
  });
});
