import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AnvilColumn from "./AnvilColumn";
import { createSlot } from "@/lib/game/items";
import type { InventorySlot } from "@/lib/game/types";

function renderColumn(overrides: Partial<Parameters<typeof AnvilColumn>[0]> = {}) {
  const props = {
    item: createSlot("diamond_sword", 1),
    inventory: [createSlot("diamond_sword", 1)] as InventorySlot[],
    selectedHotbarSlot: 0,
    xpLevel: 10,
    combineCost: 4,
    repairCost: 1,
    renameCost: 1,
    onCombine: mock(),
    onRepair: mock(),
    onRename: mock(),
    ...overrides
  };
  render(<AnvilColumn {...props} />);
  return props;
}

describe("AnvilColumn", () => {
  test("prompts to select gear when the slot isn't durable", () => {
    renderColumn({ item: createSlot("dirt", 1), inventory: [createSlot("dirt", 1)] });
    expect(screen.getByText(/Select a tool/)).toBeTruthy();
  });

  test("offers combine, repair, and rename for durable gear", () => {
    renderColumn();
    expect(screen.getByRole("button", { name: /Combine duplicate/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Repair/ })).toBeTruthy();
    expect(screen.getByLabelText("Custom item name")).toBeTruthy();
  });

  test("disables combine when there is no duplicate", () => {
    renderColumn({ inventory: [createSlot("diamond_sword", 1)] }); // the item itself is the only one
    expect((screen.getByRole("button", { name: /Combine duplicate/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("enables combine with a damaged duplicate and fires onCombine", async () => {
    const user = userEvent.setup();
    const target = { ...createSlot("diamond_sword", 1), durability: 100 };
    const props = renderColumn({ item: target, inventory: [target, { ...createSlot("diamond_sword", 1), durability: 200 }] });
    const button = screen.getByRole("button", { name: /Combine duplicate/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await user.click(button);
    expect(props.onCombine).toHaveBeenCalled();
  });

  test("disables repair on full gear and enables it when damaged with material in stock", () => {
    // Full durability → repair disabled.
    renderColumn({ inventory: [createSlot("diamond_sword", 1), createSlot("diamond_ore", 3)] });
    expect((screen.getByRole("button", { name: /Repair/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("enables repair with a damaged item and material, and fires onRepair", async () => {
    const user = userEvent.setup();
    const target = { ...createSlot("diamond_sword", 1), durability: 100 };
    const props = renderColumn({ item: target, inventory: [target, createSlot("diamond_ore", 3)] });
    const button = screen.getByRole("button", { name: /Repair/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await user.click(button);
    expect(props.onRepair).toHaveBeenCalled();
  });

  test("rename is disabled until the name changes, then fires onRename", async () => {
    const user = userEvent.setup();
    const props = renderColumn();
    const applyButton = () => screen.getByRole("button", { name: /Apply (name|rename)|Clear name/ }) as HTMLButtonElement;
    expect(applyButton().disabled).toBe(true); // no change yet
    await user.type(screen.getByLabelText("Custom item name"), "Sting");
    expect(applyButton().disabled).toBe(false);
    await user.click(applyButton());
    expect(props.onRename).toHaveBeenCalledWith("Sting");
  });
});
