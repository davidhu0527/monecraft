import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GrindstoneColumn from "./GrindstoneColumn";
import { GRINDSTONE_REFUND_XP_PER_LEVEL } from "@/lib/game/config";
import { createSlot } from "@/lib/game/items";
import type { InventorySlot } from "@/lib/game/types";

const enchanted = (...levels: Array<[string, number]>): InventorySlot => ({
  ...createSlot("diamond_sword", 1),
  enchantments: levels.map(([id, level]) => ({ id: id as never, level }))
});

describe("GrindstoneColumn", () => {
  test("prompts to select enchanted gear when there's nothing to strip", () => {
    render(<GrindstoneColumn item={createSlot("diamond_sword", 1)} onStrip={() => {}} />);
    expect(screen.getByText(/Select an enchanted/)).toBeTruthy();
  });

  test("lists the enchantments, shows the refund, and fires onStrip", async () => {
    const user = userEvent.setup();
    const onStrip = mock();
    render(<GrindstoneColumn item={enchanted(["sharpness", 3], ["unbreaking", 1])} onStrip={onStrip} />);
    expect(screen.getByText(/Sharpness/)).toBeTruthy();
    const refund = 4 * GRINDSTONE_REFUND_XP_PER_LEVEL;
    const button = screen.getByRole("button", { name: new RegExp(`returns ${refund} XP`) });
    await user.click(button);
    expect(onStrip).toHaveBeenCalled();
  });
});
