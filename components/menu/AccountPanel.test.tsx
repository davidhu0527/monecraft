import { describe, expect, test, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The panel talks to better-auth over fetch; component tests swap the client
// module for a controllable fake so no network (or server) exists.
const fake = {
  user: null as null | { id: string; name: string; email: string },
  signOutRejects: false
};

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
      if (fake.signOutRejects) throw new Error("network down");
      fake.user = null;
      return { error: null };
    }
  }),
  onlineUsed: () => true,
  markOnlineUsed: () => {},
  currentUser: async () => fake.user
}));

const { default: AccountPanel } = await import("./AccountPanel");

describe("AccountPanel", () => {
  test("logged out offers Sign in and Create account — no guest path", async () => {
    fake.user = null;
    render(<AccountPanel />);
    await waitFor(() => expect(screen.getByText("Offline")).toBeTruthy());

    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /guest/i })).toBeNull();
  });

  test("registering through the sign-up form signs the account in", async () => {
    fake.user = null;
    const onAuthChange = mock();
    render(<AccountPanel onAuthChange={onAuthChange} />);
    await waitFor(() => expect(screen.getByText("Offline")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await userEvent.type(screen.getByLabelText("Email"), "new@example.com");
    await userEvent.type(screen.getByLabelText("Display name"), "Newbie");
    await userEvent.type(screen.getByLabelText("Password"), "hunter2hunter2");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(screen.getByText("Signed in as Newbie")).toBeTruthy());
    expect(onAuthChange).toHaveBeenCalled();
  });

  test("the sign-in form still toggles into sign-up", async () => {
    fake.user = null;
    render(<AccountPanel />);
    await waitFor(() => expect(screen.getByText("Offline")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.queryByLabelText("Display name")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "I need an account" }));
    expect(screen.getByLabelText("Display name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
  });

  test("a signed-in account shows its name and can sign out", async () => {
    fake.user = { id: "u1", name: "Keeper", email: "k@example.com" };
    render(<AccountPanel />);
    await waitFor(() => expect(screen.getByText("Signed in as Keeper")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(screen.getByText("Offline")).toBeTruthy());
  });

  test("a failed sign-out surfaces an error and keeps you signed in", async () => {
    fake.user = { id: "u1", name: "Keeper", email: "k@example.com" };
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
