import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeathScreen from "@/components/game/DeathScreen";

describe("DeathScreen", () => {
  test("renders nothing while alive", () => {
    render(<DeathScreen seconds={0} onRespawn={mock()} />);
    expect(screen.queryByText("You Died!")).toBeNull();
  });

  test("shows the countdown while dead", () => {
    render(<DeathScreen seconds={2} onRespawn={mock()} />);
    expect(screen.getByText("You Died!")).toBeTruthy();
    expect(screen.getByText("Respawning in 2…")).toBeTruthy();
  });

  test("the respawn button skips the countdown", async () => {
    const user = userEvent.setup();
    const onRespawn = mock();
    render(<DeathScreen seconds={3} onRespawn={onRespawn} />);
    await user.click(screen.getByRole("button", { name: "Respawn" }));
    expect(onRespawn).toHaveBeenCalledTimes(1);
  });
});
