import { describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TOUCH_LONGPRESS_TOOLTIP_MS } from "@/lib/game/config";
import { type TooltipContent, useItemTooltip } from "@/components/game/ItemTooltip";

function Host({ content, onClick }: { content: TooltipContent; onClick?: () => void }) {
  const { tooltip, bind } = useItemTooltip();
  return (
    <div>
      <button {...bind(content)} onClick={onClick}>
        target
      </button>
      {tooltip}
    </div>
  );
}

const longPressWait = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, TOUCH_LONGPRESS_TOOLTIP_MS + 80));
  });

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

  test("a touch long-press shows the tooltip and swallows the follow-up click", async () => {
    const onClick = mock(() => {});
    render(<Host content={{ title: "Bread" }} onClick={onClick} />);
    const target = screen.getByRole("button", { name: "target" });

    fireEvent.pointerDown(target, { pointerId: 1, pointerType: "touch", clientX: 50, clientY: 50 });
    await longPressWait();
    expect(screen.getByText("Bread")).toBeTruthy();

    fireEvent.pointerUp(target, { pointerId: 1, pointerType: "touch" });
    fireEvent.click(target);
    expect(onClick).not.toHaveBeenCalled(); // the long-press is not also a slot click

    fireEvent.click(target); // only the one click is swallowed
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("a quick tap neither shows the tooltip nor swallows the click", async () => {
    const onClick = mock(() => {});
    render(<Host content={{ title: "Bread" }} onClick={onClick} />);
    const target = screen.getByRole("button", { name: "target" });

    fireEvent.pointerDown(target, { pointerId: 1, pointerType: "touch", clientX: 50, clientY: 50 });
    fireEvent.pointerUp(target, { pointerId: 1, pointerType: "touch" });
    fireEvent.click(target);
    await longPressWait();
    expect(screen.queryByText("Bread")).toBeNull();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("dragging past the slop cancels the pending long-press", async () => {
    render(<Host content={{ title: "Bread" }} />);
    const target = screen.getByRole("button", { name: "target" });
    fireEvent.pointerDown(target, { pointerId: 1, pointerType: "touch", clientX: 50, clientY: 50 });
    fireEvent.pointerMove(target, { pointerId: 1, pointerType: "touch", clientX: 90, clientY: 50 });
    await longPressWait();
    expect(screen.queryByText("Bread")).toBeNull();
  });

  test("the next touch anywhere dismisses a long-press tooltip", async () => {
    render(<Host content={{ title: "Bread" }} />);
    const target = screen.getByRole("button", { name: "target" });
    fireEvent.pointerDown(target, { pointerId: 1, pointerType: "touch", clientX: 50, clientY: 50 });
    await longPressWait();
    fireEvent.pointerUp(target, { pointerId: 1, pointerType: "touch" });
    expect(screen.getByText("Bread")).toBeTruthy();

    fireEvent.pointerDown(document.body, { pointerId: 2, pointerType: "touch" });
    expect(screen.queryByText("Bread")).toBeNull();
  });
});
