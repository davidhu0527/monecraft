import { describe, expect, test, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MAX_ONLINE_PROFILES } from "@/lib/game/config";

// The account home talks to the server over fetch; swap the profiles/auth
// client modules for controllable fakes so no network (or DB) exists.
const fake = {
  profiles: [] as { id: string; name: string; skinId: string | null; createdAt: string }[],
  signedOut: false,
  signOutRejects: false
};

void mock.module("@/lib/online/profilesClient", () => ({
  listOnlineProfiles: async () => fake.profiles,
  createOnlineProfile: async ({ name }: { name: string }) => {
    const created = { id: `p-${fake.profiles.length + 1}`, name, skinId: null, createdAt: `${fake.profiles.length}` };
    fake.profiles = [...fake.profiles, created];
    return created;
  },
  updateOnlineProfile: async () => true,
  deleteOnlineProfile: async (id: string) => {
    fake.profiles = fake.profiles.filter((p) => p.id !== id);
    return true;
  }
}));

void mock.module("@/lib/auth/client", () => ({
  authClient: () => ({
    signOut: async () => {
      if (fake.signOutRejects) throw new Error("network down");
      fake.signedOut = true;
      return { error: null };
    }
  })
}));

const { default: AccountProfileSelect } = await import("./AccountProfileSelect");

const user = { id: "u1", name: "Keeper", email: "k@example.com", isAnonymous: false };

describe("AccountProfileSelect", () => {
  test("lists the account's profiles and enters the chosen one", async () => {
    fake.profiles = [
      { id: "p1", name: "Steve", skinId: "default", createdAt: "1" },
      { id: "p2", name: "Alex", skinId: "alex", createdAt: "2" }
    ];
    const onPlay = mock();
    render(<AccountProfileSelect user={user} onPlay={onPlay} onSignedOut={mock()} />);
    await waitFor(() => expect(screen.getByText("Steve")).toBeTruthy());
    expect(screen.getByText("Alex")).toBeTruthy();
    expect(screen.getByText("Signed in as Keeper")).toBeTruthy();

    await userEvent.click(screen.getByTestId("online-profile-p1"));
    expect(onPlay).toHaveBeenCalled();
  });

  test("creating a profile enters it", async () => {
    fake.profiles = [];
    const onPlay = mock();
    render(<AccountProfileSelect user={user} onPlay={onPlay} onSignedOut={mock()} />);
    await waitFor(() => expect(screen.getByText(/No profiles yet/)).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "New Profile" }));
    await userEvent.type(screen.getByLabelText("Profile name"), "Newbie");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onPlay).toHaveBeenCalled());
  });

  test("the create button is disabled once the profile cap is reached", async () => {
    fake.profiles = Array.from({ length: MAX_ONLINE_PROFILES }, (_, i) => ({ id: `p${i}`, name: `P${i}`, skinId: null, createdAt: `${i}` }));
    render(<AccountProfileSelect user={user} onPlay={mock()} onSignedOut={mock()} />);
    await waitFor(() => expect(screen.getByText("P0")).toBeTruthy());
    expect((screen.getByTestId("new-online-profile") as HTMLButtonElement).disabled).toBe(true);
  });

  test("sign out clears the session and notifies the parent", async () => {
    fake.profiles = [];
    fake.signedOut = false;
    const onSignedOut = mock();
    render(<AccountProfileSelect user={user} onPlay={mock()} onSignedOut={onSignedOut} />);
    await waitFor(() => expect(screen.getByText("Signed in as Keeper")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
    expect(fake.signedOut).toBe(true);
  });

  test("a failed sign-out surfaces an error and stays signed in", async () => {
    fake.profiles = [];
    fake.signOutRejects = true;
    const onSignedOut = mock();
    render(<AccountProfileSelect user={user} onPlay={mock()} onSignedOut={onSignedOut} />);
    await waitFor(() => expect(screen.getByText("Signed in as Keeper")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(screen.getByText(/Couldn't sign out/)).toBeTruthy());
    expect(onSignedOut).not.toHaveBeenCalled();
    fake.signOutRejects = false;
  });
});
