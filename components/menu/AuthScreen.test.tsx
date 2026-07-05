import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The form talks to better-auth over fetch; swap the client module for a
// controllable fake. Mirror the module's FULL export surface — bun's
// mock.module fixes the shape for whichever test file loads first.
const fake = {
  user: null as null | { id: string; name: string; email: string }
};
// Reads through a call so TS's flow narrowing (fake.user = null in a test)
// doesn't collapse the type at the assertion site.
const fakeUserName = () => fake.user?.name;

void mock.module("@/lib/auth/client", () => ({
  authClient: () => ({
    signUp: {
      email: async ({ email, name }: { email: string; name: string }) => {
        fake.user = { id: "u-new", name, email };
        return { error: null };
      }
    },
    signIn: {
      email: async ({ email }: { email: string }) => {
        fake.user = { id: "u-known", name: email.split("@")[0], email };
        return { error: null };
      }
    },
    signOut: async () => {
      fake.user = null;
      return { error: null };
    }
  }),
  onlineUsed: () => true,
  markOnlineUsed: () => {},
  currentUser: async () => fake.user
}));

const { default: AuthScreen } = await import("./AuthScreen");

describe("AuthScreen", () => {
  test("opens directly on the sign-in form — no closed state, no local-profile UI", () => {
    render(<AuthScreen onAuthChange={mock()} onBack={mock()} />);

    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy(); // the submit
    // Sign-in mode until toggled; nothing about local profiles.
    expect(screen.queryByLabelText("Display name")).toBeNull();
    expect(screen.queryByLabelText("Profile name")).toBeNull();
  });

  test("the toggle flips to the create-account form and back", async () => {
    const user = userEvent.setup();
    render(<AuthScreen onAuthChange={mock()} onBack={mock()} />);

    await user.click(screen.getByRole("button", { name: "I need an account" }));
    expect(screen.getByLabelText("Display name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "I have an account" }));
    expect(screen.queryByLabelText("Display name")).toBeNull();
  });

  test("Back returns to the welcome gate", async () => {
    const user = userEvent.setup();
    const onBack = mock();
    render(<AuthScreen onAuthChange={mock()} onBack={onBack} />);

    await user.click(screen.getByTestId("back-to-welcome"));
    expect(onBack).toHaveBeenCalled();
  });

  test("a successful sign-in notifies the shell", async () => {
    const user = userEvent.setup();
    fake.user = null;
    const onAuthChange = mock();
    render(<AuthScreen onAuthChange={onAuthChange} onBack={mock()} />);

    await user.type(screen.getByLabelText("Email"), "keeper@example.com");
    await user.type(screen.getByLabelText("Password"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(onAuthChange).toHaveBeenCalled();
    expect(fakeUserName()).toBe("keeper");
  });

  test("registering through the toggle notifies the shell too", async () => {
    const user = userEvent.setup();
    fake.user = null;
    const onAuthChange = mock();
    render(<AuthScreen onAuthChange={onAuthChange} onBack={mock()} />);

    await user.click(screen.getByRole("button", { name: "I need an account" }));
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText("Display name"), "Newbie");
    await user.type(screen.getByLabelText("Password"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(onAuthChange).toHaveBeenCalled();
    expect(fakeUserName()).toBe("Newbie");
  });
});
