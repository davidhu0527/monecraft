import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GameOverScreen from "@/components/game/GameOverScreen";

function renderScreen(overrides: Partial<Parameters<typeof GameOverScreen>[0]> = {}) {
  const props = { show: true, onQuitToWorlds: mock(), onDeleteWorld: mock(), ...overrides };
  render(<GameOverScreen {...props} />);
  return props;
}

describe("GameOverScreen", () => {
  test("renders nothing when not shown", () => {
    renderScreen({ show: false });
    expect(screen.queryByText("Game Over")).toBeNull();
  });

  test("Back to Worlds fires its callback", async () => {
    const user = userEvent.setup();
    const props = renderScreen();
    await user.click(screen.getByRole("button", { name: "Back to Worlds" }));
    expect(props.onQuitToWorlds).toHaveBeenCalledTimes(1);
  });

  test("deleting requires a confirmation step", async () => {
    const user = userEvent.setup();
    const props = renderScreen();
    await user.click(screen.getByRole("button", { name: "Delete World" }));
    expect(props.onDeleteWorld).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm Delete" }));
    expect(props.onDeleteWorld).toHaveBeenCalledTimes(1);
  });

  test("Spectate World minimizes to a badge that re-opens the menu", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "Spectate World" }));
    expect(screen.queryByText("Game Over")).toBeNull(); // overlay hidden while spectating
    await user.click(screen.getByRole("button", { name: "Open Game Over menu" }));
    expect(screen.getByText("Game Over")).toBeTruthy(); // badge re-opens it
  });
});
