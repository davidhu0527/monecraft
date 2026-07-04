import { describe, expect, test, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MAX_WORLDS_PER_PROFILE } from "@/lib/game/config";
import type { OnlineWorld } from "@/lib/online/onlineClient";

// Swap the online worlds client for a controllable fake — no network/game server.
const fake = { worlds: [] as OnlineWorld[] };

function mpWorld(id: string, profileId: string, overrides: Partial<OnlineWorld> = {}): OnlineWorld {
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
  };
}

void mock.module("@/lib/online/onlineClient", () => ({
  listOnlineWorlds: async () => fake.worlds,
  createOnlineWorld: async ({ name, profileId }: { name: string; profileId?: string }) => {
    const created = mpWorld(`new-${fake.worlds.length}`, profileId ?? "", { name });
    fake.worlds = [...fake.worlds, created];
    return created;
  },
  createInviteLink: async () => "http://localhost/join/tok",
  revokeInviteLinks: async () => 1
}));

const { default: OnlineWorldSelect } = await import("./OnlineWorldSelect");

const profile = { id: "p1", name: "Steve", skinId: "default", createdAt: "1" };

describe("OnlineWorldSelect", () => {
  test("lists only this profile's mp worlds and joins the chosen one", async () => {
    fake.worlds = [mpWorld("w1", "p1"), mpWorld("w2", "p2"), mpWorld("w3", "p1", { kind: "sp-cloud" })];
    const onPlay = mock();
    render(<OnlineWorldSelect profile={profile} onPlay={onPlay} onBack={mock()} />);
    await waitFor(() => expect(screen.getByText("W-w1")).toBeTruthy());
    expect(screen.queryByText("W-w2")).toBeNull(); // a different profile's world
    expect(screen.queryByText("W-w3")).toBeNull(); // sp-cloud, not an online room

    await userEvent.click(screen.getByTestId("online-world-w1"));
    expect(onPlay).toHaveBeenCalled();
  });

  test("creating an online world enters it", async () => {
    fake.worlds = [];
    const onPlay = mock();
    render(<OnlineWorldSelect profile={profile} onPlay={onPlay} onBack={mock()} />);
    await waitFor(() => expect(screen.getByText(/No online worlds yet/)).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "New Online World" }));
    await userEvent.type(screen.getByLabelText("World name"), "Co-op");
    await userEvent.click(screen.getByRole("button", { name: "Create World" }));
    await waitFor(() => expect(onPlay).toHaveBeenCalled());
  });

  test("New Online World is disabled at the per-profile world cap", async () => {
    fake.worlds = Array.from({ length: MAX_WORLDS_PER_PROFILE }, (_, i) => mpWorld(`w${i}`, "p1"));
    render(<OnlineWorldSelect profile={profile} onPlay={mock()} onBack={mock()} />);
    await waitFor(() => expect(screen.getByText("W-w0")).toBeTruthy());
    expect((screen.getByTestId("new-online-world") as HTMLButtonElement).disabled).toBe(true);
  });
});
