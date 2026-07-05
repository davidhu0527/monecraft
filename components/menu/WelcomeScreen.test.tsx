import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WelcomeScreen from "@/components/menu/WelcomeScreen";

describe("WelcomeScreen", () => {
  test("offers exactly the two doors, with accessible names the e2e keys on", () => {
    render(<WelcomeScreen onSignIn={mock()} onPlayLocally={mock()} />);

    // Exact names: the captions must live outside the buttons.
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play locally" })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(2);

    // The copy explains the choice: account for online, none for local.
    expect(screen.getByText(/needs a free account/)).toBeTruthy();
    expect(screen.getByText(/no account needed/)).toBeTruthy();
  });

  test("each door fires its callback", async () => {
    const user = userEvent.setup();
    const onSignIn = mock();
    const onPlayLocally = mock();
    render(<WelcomeScreen onSignIn={onSignIn} onPlayLocally={onPlayLocally} />);

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSignIn).toHaveBeenCalled();
    expect(onPlayLocally).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Play locally" }));
    expect(onPlayLocally).toHaveBeenCalled();
  });
});
