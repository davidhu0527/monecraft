import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PauseMenu from "@/components/game/PauseMenu";

function renderMenu(overrides: Partial<Parameters<typeof PauseMenu>[0]> = {}) {
  const props = {
    saveMessage: "",
    onBack: mock(),
    onSave: mock(),
    onLoad: mock(),
    onReset: mock(),
    ...overrides
  };
  render(<PauseMenu {...props} />);
  return props;
}

describe("PauseMenu", () => {
  test("buttons dispatch their callbacks", async () => {
    const user = userEvent.setup();
    const props = renderMenu();
    await user.click(screen.getByRole("button", { name: "Back to Game" }));
    await user.click(screen.getByRole("button", { name: "Save Game" }));
    await user.click(screen.getByRole("button", { name: "Load Save" }));
    expect(props.onBack).toHaveBeenCalledTimes(1);
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onLoad).toHaveBeenCalledTimes(1);
  });

  test("reset requires a confirmation step", async () => {
    const user = userEvent.setup();
    const props = renderMenu();
    await user.click(screen.getByRole("button", { name: "Reset World" }));
    expect(props.onReset).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm Reset" }));
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  test("cancel backs out of the reset confirmation", async () => {
    const user = userEvent.setup();
    const props = renderMenu();
    await user.click(screen.getByRole("button", { name: "Reset World" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Reset World" })).toBeTruthy();
    expect(props.onReset).not.toHaveBeenCalled();
  });

  test("shows the transient save message", () => {
    renderMenu({ saveMessage: "Saved" });
    expect(screen.getByText("Saved")).toBeTruthy();
  });
});
