import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CreativeInventoryTab from "@/components/game/CreativeInventoryTab";
import { ITEM_DEFS } from "@/lib/game/items";

function giveButtons() {
  return screen
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? "")
    .filter((label) => label.startsWith("Give "));
}

describe("CreativeInventoryTab", () => {
  test("lists every item and gives one on click", async () => {
    const onGiveItem = mock();
    render(<CreativeInventoryTab onGiveItem={onGiveItem} />);
    expect(giveButtons()).toHaveLength(ITEM_DEFS.length); // every item kind is covered

    await userEvent.click(screen.getByRole("button", { name: "Give Dirt" }));
    expect(onGiveItem).toHaveBeenCalledWith("dirt");
  });

  test("the search box filters the list", async () => {
    render(<CreativeInventoryTab onGiveItem={mock()} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Search creative items" }), "diamond");
    const labels = giveButtons();
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((label) => label.toLowerCase().includes("diamond"))).toBe(true);
  });
});
