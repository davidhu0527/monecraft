import { describe, expect, test, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The panel talks to better-auth over fetch; component tests swap the client
// module for a controllable fake so no network (or server) exists.
const fake = {
  user: null as null | { id: string; name: string; email: string; isAnonymous: boolean },
  signInAnonymousCalls: 0,
  signOutRejects: false
};

void mock.module("@/lib/auth/client", () => ({
  authClient: () => ({
    signUp: { email: async () => ({ error: null }) },
    signIn: {
      email: async () => ({ error: null }),
      anonymous: async () => {
        fake.signInAnonymousCalls += 1;
        fake.user = { id: "guest-1", name: "Anonymous", email: "temp@x", isAnonymous: true };
        return { error: null };
      }
    },
    signOut: async () => {
      if (fake.signOutRejects) throw new Error("network down");
      fake.user = null;
      return { error: null };
    }
  }),
  onlineUsed: () => true,
  markOnlineUsed: () => {},
  currentUser: async () => fake.user,
  ensureSignedIn: async () => {
    if (!fake.user) {
      fake.signInAnonymousCalls += 1;
      fake.user = { id: "guest-1", name: "Anonymous", email: "temp@x", isAnonymous: true };
    }
    return fake.user;
  }
}));

const { default: AccountPanel } = await import("./AccountPanel");

describe("AccountPanel", () => {
  test("offline → guest → upgrade offer", async () => {
    fake.user = null;
    render(<AccountPanel />);
    await waitFor(() => expect(screen.getByText("Offline")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "Play online as guest" }));
    await waitFor(() => expect(screen.getByText("Playing as guest")).toBeTruthy());
    expect(fake.signInAnonymousCalls).toBe(1);

    // A guest is offered the worlds-keeping upgrade, which opens the sign-up form.
    await userEvent.click(screen.getByRole("button", { name: "Keep my worlds — create account" }));
    expect(screen.getByText("Create account (keeps your worlds)")).toBeTruthy();
    expect(screen.getByText("Email")).toBeTruthy();
  });

  test("a guest can sign out and return to the login screen", async () => {
    fake.user = null;
    render(<AccountPanel />);
    await waitFor(() => expect(screen.getByText("Offline")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "Play online as guest" }));
    await waitFor(() => expect(screen.getByText("Playing as guest")).toBeTruthy());

    // A guest previously had no way back; sign out returns to the offline/login state.
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(screen.getByText("Offline")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  test("a signed-in account shows its name and can sign out", async () => {
    fake.user = { id: "u1", name: "Keeper", email: "k@example.com", isAnonymous: false };
    render(<AccountPanel />);
    await waitFor(() => expect(screen.getByText("Signed in as Keeper")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(screen.getByText("Offline")).toBeTruthy());
  });

  test("a failed sign-out surfaces an error and keeps you signed in", async () => {
    fake.user = { id: "u1", name: "Keeper", email: "k@example.com", isAnonymous: false };
    fake.signOutRejects = true;
    render(<AccountPanel />);
    await waitFor(() => expect(screen.getByText("Signed in as Keeper")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    // The rejection is caught: a visible error, still signed in, and the control is usable again.
    await waitFor(() => expect(screen.getByText(/Couldn't reach the server/)).toBeTruthy());
    expect(screen.getByText("Signed in as Keeper")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Sign out" }) as HTMLButtonElement).disabled).toBe(false);
    fake.signOutRejects = false;
  });
});
