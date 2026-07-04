import { describe, expect, test, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MAX_WORLDS_PER_PROFILE } from "@/lib/game/config";
import type { OnlineWorld } from "@/lib/online/onlineClient";

// Swap the online worlds client for a controllable fake — no network/game server.
const fake = { worlds: [] as OnlineWorld[], created: [] as Array<{ name: string; kind?: string; profileId?: string }>, deleted: [] as string[] };

function mpWorld(id: string, profileId: string | null, overrides: Partial<OnlineWorld> = {}): OnlineWorld {
  return {
    id,
    name: `W-${id}`,
    kind: "mp",
    seed: 1,
    worldType: "default",
    gameMode: "survival",
    difficulty: "normal",
    hardcore: false,
    worldgenVersion: 11,
    role: "owner",
    profileId,
    updatedAt: "2026-07-04T00:00:00.000Z",
    ...overrides
  } as OnlineWorld;
}

// Mirror the real module's full export surface: bun's mock.module can't add
// names to an already-created module namespace, so whichever test file mocks
// this module first fixes the shape every later import sees.
void mock.module("@/lib/online/onlineClient", () => ({
  listOnlineWorlds: async () => fake.worlds,
  createOnlineWorld: async ({ name, kind, profileId }: { name: string; kind?: "mp" | "sp-cloud"; profileId?: string }) => {
    fake.created.push({ name, kind, profileId });
    const created = mpWorld(`new-${fake.worlds.length}`, profileId ?? "", { name, kind: kind ?? "mp" });
    fake.worlds = [...fake.worlds, created];
    return created;
  },
  createInviteLink: async () => "http://localhost/join/tok",
  revokeInviteLinks: async () => 1,
  deleteOnlineWorld: async (id: string) => {
    fake.deleted.push(id);
    fake.worlds = fake.worlds.filter((world) => world.id !== id);
    return true;
  },
  resolveInviteToken: async () => null,
  acceptInviteToken: async () => false,
  requestJoinTicket: async () => null
}));

const { default: OnlineWorldSelect } = await import("./OnlineWorldSelect");

const profile = { id: "p1", name: "Steve", skinId: "default", createdAt: "1" };

function renderSelect(handlers: { onPlayOnline?: ReturnType<typeof mock>; onPlayCloud?: ReturnType<typeof mock> } = {}) {
  return render(
    <OnlineWorldSelect profile={profile} onPlayOnline={handlers.onPlayOnline ?? mock()} onPlayCloud={handlers.onPlayCloud ?? mock()} onBack={mock()} />
  );
}

describe("OnlineWorldSelect", () => {
  test("lists this profile's own mp worlds and joins the chosen one", async () => {
    fake.worlds = [mpWorld("w1", "p1"), mpWorld("w2", "p2")];
    const onPlayOnline = mock();
    renderSelect({ onPlayOnline });
    await waitFor(() => expect(screen.getByText("W-w1")).toBeTruthy());
    expect(screen.queryByText("W-w2")).toBeNull(); // a different profile's world

    await userEvent.click(screen.getByTestId("online-world-w1"));
    expect(onPlayOnline).toHaveBeenCalled();
  });

  test("worlds joined by invite show under every profile, without owner actions", async () => {
    // Membership is account-level: the joined world carries the HOST's profile
    // id, so it must surface via its member role, not a profileId match.
    fake.worlds = [mpWorld("mine", "p1"), mpWorld("theirs", "host-profile", { role: "member" })];
    renderSelect();
    await waitFor(() => expect(screen.getByText("W-theirs")).toBeTruthy());
    expect(screen.getByText(/Joined/)).toBeTruthy();
    // Invite management stays owner-only: exactly one card (the owned one) has it.
    expect(screen.getAllByRole("button", { name: "Copy invite" }).length).toBe(1);
    expect(screen.getAllByRole("button", { name: "Revoke links" }).length).toBe(1);
  });

  test("singleplayer worlds split into their own section: own and account-level, not other profiles'", async () => {
    fake.worlds = [
      mpWorld("room", "p1"),
      mpWorld("sp-own", "p1", { kind: "sp-cloud" }),
      // Uploaded from the local menus before profiles existed: account-level,
      // shown under every profile.
      mpWorld("sp-legacy", null, { kind: "sp-cloud" }),
      mpWorld("sp-other", "p2", { kind: "sp-cloud" })
    ];
    const onPlayCloud = mock();
    renderSelect({ onPlayCloud });
    await waitFor(() => expect(screen.getByText("W-sp-own")).toBeTruthy());
    expect(screen.getByText("W-sp-legacy")).toBeTruthy();
    expect(screen.queryByText("W-sp-other")).toBeNull(); // another profile's singleplayer world
    expect(screen.queryByTestId("online-world-sp-own")).toBeNull(); // not in the mp section
    expect(screen.getAllByText(/Singleplayer · synced/).length).toBe(2);

    await userEvent.click(screen.getByTestId("cloud-sp-sp-own"));
    expect(onPlayCloud).toHaveBeenCalled();
  });

  test("creating an online world enters it", async () => {
    fake.worlds = [];
    const onPlayOnline = mock();
    renderSelect({ onPlayOnline });
    await waitFor(() => expect(screen.getByText(/No online worlds yet/)).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "New Online World" }));
    await userEvent.type(screen.getByLabelText("World name"), "Co-op");
    await userEvent.click(screen.getByRole("button", { name: "Create World" }));
    await waitFor(() => expect(onPlayOnline).toHaveBeenCalled());
    expect(fake.created.at(-1)).toMatchObject({ name: "Co-op", kind: undefined, profileId: "p1" });
  });

  test("creating a singleplayer world sends kind sp-cloud and enters it client-side", async () => {
    fake.worlds = [];
    fake.created = [];
    const onPlayCloud = mock();
    const onPlayOnline = mock();
    renderSelect({ onPlayCloud, onPlayOnline });
    await waitFor(() => expect(screen.getByText(/No singleplayer worlds yet/)).toBeTruthy());

    await userEvent.click(screen.getByTestId("new-sp-world"));
    await userEvent.type(screen.getByLabelText("World name"), "Solo Base");
    await userEvent.click(screen.getByRole("button", { name: "Create World" }));
    await waitFor(() => expect(onPlayCloud).toHaveBeenCalled());
    expect(onPlayOnline).not.toHaveBeenCalled();
    expect(fake.created.at(-1)).toMatchObject({ name: "Solo Base", kind: "sp-cloud", profileId: "p1" });
  });

  test("deleting a singleplayer world asks for confirmation first", async () => {
    fake.worlds = [mpWorld("sp1", "p1", { kind: "sp-cloud" })];
    fake.deleted = [];
    renderSelect();
    await waitFor(() => expect(screen.getByText("W-sp1")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(fake.deleted).toEqual([]); // confirm step — nothing deleted yet
    await userEvent.click(screen.getByRole("button", { name: "Delete" })); // confirm
    await waitFor(() => expect(fake.deleted).toEqual(["sp1"]));
    await waitFor(() => expect(screen.queryByText("W-sp1")).toBeNull());
  });

  test("owned worlds of BOTH kinds count toward the create cap", async () => {
    // The server counts every world owned by the profile, kind-blind — the
    // client must match or it would enable creates the server refuses.
    fake.worlds = [...Array.from({ length: MAX_WORLDS_PER_PROFILE - 1 }, (_, i) => mpWorld(`w${i}`, "p1")), mpWorld("sp1", "p1", { kind: "sp-cloud" })];
    renderSelect();
    await waitFor(() => expect(screen.getByText("W-w0")).toBeTruthy());
    expect((screen.getByTestId("new-online-world") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("new-sp-world") as HTMLButtonElement).disabled).toBe(true);
  });

  test("joined and account-level worlds don't count toward the create cap", async () => {
    // One short of the cap in owned worlds; joined mp rooms and profile-less
    // (account-level) singleplayer saves must not tip it over.
    fake.worlds = [
      ...Array.from({ length: MAX_WORLDS_PER_PROFILE - 1 }, (_, i) => mpWorld(`w${i}`, "p1")),
      mpWorld("j1", "host-profile", { role: "member" }),
      mpWorld("legacy", null, { kind: "sp-cloud" })
    ];
    renderSelect();
    await waitFor(() => expect(screen.getByText("W-j1")).toBeTruthy());
    expect((screen.getByTestId("new-online-world") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("new-sp-world") as HTMLButtonElement).disabled).toBe(false);
  });
});
