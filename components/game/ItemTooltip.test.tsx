import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type TooltipContent, useItemTooltip } from "@/components/game/ItemTooltip";

function Host({ content }: { content: TooltipContent }) {
  const { tooltip, bind } = useItemTooltip();
  return (
    <div>
      <button {...bind(content)}>target</button>
      {tooltip}
    </div>
  );
}

describe("useItemTooltip", () => {
  test("shows the title and sub-lines on hover and hides on leave", async () => {
    const user = userEvent.setup();
    render(<Host content={{ title: "Wood Pickaxe", lines: ["Durability 59 / 59"] }} />);

    expect(screen.queryByText("Wood Pickaxe")).toBeNull();

    await user.hover(screen.getByRole("button", { name: "target" }));
    expect(screen.getByText("Wood Pickaxe")).toBeTruthy();
    expect(screen.getByText("Durability 59 / 59")).toBeTruthy();
    // The tooltip is decorative; the accessible name comes from the element itself.
    expect(screen.getByText("Wood Pickaxe").closest(".item-tooltip")?.getAttribute("aria-hidden")).toBe("true");

    await user.unhover(screen.getByRole("button", { name: "target" }));
    expect(screen.queryByText("Wood Pickaxe")).toBeNull();
  });

  test("renders no tooltip for null content (empty slot)", async () => {
    const user = userEvent.setup();
    render(<Host content={null} />);
    await user.hover(screen.getByRole("button", { name: "target" }));
    expect(document.querySelector(".item-tooltip")).toBeNull();
  });
});
