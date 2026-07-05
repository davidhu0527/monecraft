import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createProfile, type Profile } from "@/lib/game/profiles";
import { createWorld, readWorlds } from "@/lib/game/worlds";
import type { OnlineWorld } from "@/lib/online/onlineClient";

// The cloud-save section talks to the server through onlineClient; swap the
// module for a controllable fake so no network exists. Mirror the real
// module's full export surface: bun's mock.module can't add names to an
// already-created module namespace, so whichever test file mocks this module
// first fixes the shape every later import sees.
const cloud = {
  worlds: [] as OnlineWorld[],
  createRejects: false,
  listCalls: 0
};

void mock.module("@/lib/online/onlineClient", () => ({
  listOnlineWorlds: async () => {
    cloud.listCalls += 1;
    return cloud.worlds;
  },
  createOnlineWorld: async ({ name, kind }: { name: string; kind?: string }) => {
    if (cloud.createRejects) return null;
    const created = summary(`new-${cloud.worlds.length}`, name, (kind ?? "mp") as "mp" | "sp-cloud");
    cloud.worlds = [...cloud.worlds, created];
    return created;
  },
  createInviteLink: async () => null,
  revokeInviteLinks: async () => null,
  deleteOnlineWorld: async () => true,
  resolveInviteToken: async () => null,
  acceptInviteToken: async () => false,
  requestJoinTicket: async () => null
}));

const { default: WorldSelect } = await import("@/components/menu/WorldSelect");

function summary(id: string, name: string, kind: "mp" | "sp-cloud"): OnlineWorld {
  return {
    id,
    name,
    kind,
    seed: 1,
    worldType: "default",
    gameMode: "survival",
    difficulty: "normal",
    hardcore: false,
    worldgenVersion: 11,
    role: "owner",
    updatedAt: "x"
  } as OnlineWorld;
}

const PROFILE: Profile = { id: "p1", name: "Tester", skinId: "default", createdAt: 1 };

beforeEach(() => {
  localStorage.clear();
  cloud.worlds = [];
  cloud.createRejects = false;
  cloud.listCalls = 0;
  // createWorld requires the owning profile to exist, so seed it with a known id.
  createProfile("Tester", "default", { uid: () => "p1" });
});

describe("WorldSelect", () => {
  test("lists only this profile's worlds, most-recent first, and plays one", async () => {
    const user = userEvent.setup();
    createProfile("Other", "default", { uid: () => "other" });
    createWorld("p1", "Alpha", "1", { now: () => 10, uid: () => "wa" });
    createWorld("p1", "Beta", "2", { now: () => 20, uid: () => "wb" });
    createWorld("other", "Hidden", "3", { uid: () => "wo" });
    const onPlay = mock();
    render(<WorldSelect profile={PROFILE} onPlay={onPlay} onDownloadCloud={() => {}} cloudEnabled={false} onBack={mock()} />);

    expect(screen.queryByText("Hidden")).toBeNull();
    const names = screen.getAllByText(/Alpha|Beta/).map((n) => n.textContent);
    expect(names).toEqual(["Beta", "Alpha"]); // Beta played more recently

    await user.click(screen.getByTestId("world-wa"));
    expect(onPlay).toHaveBeenCalledWith("wa");
  });

  test("empty state invites creating the first world", () => {
    render(<WorldSelect profile={PROFILE} onPlay={mock()} onDownloadCloud={() => {}} cloudEnabled={false} onBack={mock()} />);
    expect(screen.getByText(/No worlds yet/i)).toBeTruthy();
  });

  test("creating a world persists it for the profile and enters it", async () => {
    const user = userEvent.setup();
    const onPlay = mock();
    render(<WorldSelect profile={PROFILE} onPlay={onPlay} onDownloadCloud={() => {}} cloudEnabled={false} onBack={mock()} />);

    await user.click(screen.getByTestId("new-world"));
    await user.type(screen.getByLabelText("World name"), "Hardcore");
    await user.type(screen.getByLabelText("World seed"), "99");
    await user.click(screen.getByRole("button", { name: "Create World" }));

    const worlds = readWorlds().worlds;
    expect(worlds).toHaveLength(1);
    expect(worlds[0]).toMatchObject({ profileId: "p1", name: "Hardcore", seed: 99 });
    expect(onPlay).toHaveBeenCalledWith(worlds[0].id);
  });

  test("creating a world of a chosen type persists that type", async () => {
    const user = userEvent.setup();
    render(<WorldSelect profile={PROFILE} onPlay={mock()} onDownloadCloud={() => {}} cloudEnabled={false} onBack={mock()} />);

    await user.click(screen.getByTestId("new-world"));
    await user.type(screen.getByLabelText("World name"), "Sky");
    await user.click(screen.getByRole("button", { name: "Islands world type" }));
    await user.click(screen.getByRole("button", { name: "Create World" }));

    expect(readWorlds().worlds[0].worldType).toBe("islands");
  });

  test("deleting a world removes it after confirmation", async () => {
    const user = userEvent.setup();
    createWorld("p1", "Doomed", "1", { uid: () => "wd" });
    render(<WorldSelect profile={PROFILE} onPlay={mock()} onDownloadCloud={() => {}} cloudEnabled={false} onBack={mock()} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete" })); // confirm
    expect(screen.queryByText("Doomed")).toBeNull();
    expect(readWorlds().worlds).toHaveLength(0);
  });

  test("renaming a world updates the manifest", async () => {
    const user = userEvent.setup();
    createWorld("p1", "Old", "1", { uid: () => "wr" });
    render(<WorldSelect profile={PROFILE} onPlay={mock()} onDownloadCloud={() => {}} cloudEnabled={false} onBack={mock()} />);

    await user.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByLabelText("Rename world");
    await user.clear(input);
    await user.type(input, "Renamed");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(readWorlds().worlds[0].name).toBe("Renamed");
    expect(screen.getByText("Renamed")).toBeTruthy();
  });

  test("back returns to the profile list", async () => {
    const user = userEvent.setup();
    const onBack = mock();
    render(<WorldSelect profile={PROFILE} onPlay={mock()} onDownloadCloud={() => {}} cloudEnabled={false} onBack={onBack} />);
    await user.click(screen.getByTestId("back-to-profiles"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test("with cloud enabled: sp-cloud saves download, mp rooms stay out, upload vs synced per local world", async () => {
    cloud.worlds = [summary("mp1", "Co-op World", "mp"), summary("cloud1", "Cloud World", "sp-cloud")];
    const user = userEvent.setup();
    createWorld("p1", "Local", "1", { uid: () => "wl" }); // no cloudId → Upload button
    createWorld("p1", "Backed", "1", { uid: () => "ws", cloudId: "cloudX" }); // linked → Synced badge

    const onDownload = mock();
    render(<WorldSelect profile={PROFILE} onPlay={mock()} onDownloadCloud={onDownload} cloudEnabled={true} onBack={mock()} />);

    // The sp-cloud save is downloadable; mp rooms live in the account menu now.
    await user.click(await screen.findByTestId("cloud-world-cloud1"));
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("online-world-mp1")).toBeNull();
    expect(screen.queryByText("Online Worlds")).toBeNull();

    // Local worlds: the unlinked one offers upload, the linked one reads Synced.
    expect(screen.getByRole("button", { name: /Upload to cloud/ })).toBeTruthy();
    expect(screen.getByText(/Synced/)).toBeTruthy();
  });

  test("cloud access flipping off clears the fetched cloud list", async () => {
    cloud.worlds = [summary("cloud1", "Cloud World", "sp-cloud")];
    const { rerender } = render(<WorldSelect profile={PROFILE} onPlay={mock()} onDownloadCloud={() => {}} cloudEnabled={true} onBack={mock()} />);
    await waitFor(() => expect(screen.getByTestId("cloud-world-cloud1")).toBeTruthy());

    rerender(<WorldSelect profile={PROFILE} onPlay={mock()} onDownloadCloud={() => {}} cloudEnabled={false} onBack={mock()} />);
    await waitFor(() => expect(screen.queryByTestId("cloud-world-cloud1")).toBeNull());
    expect(screen.queryByText("Cloud Saves")).toBeNull();
  });

  test("logged out (cloud disabled) the list is purely local — no fetch, no cloud buttons", () => {
    createWorld("p1", "Backed", "1", { uid: () => "ws", cloudId: "cloudX" }); // linked, but logged out
    render(<WorldSelect profile={PROFILE} onPlay={mock()} onDownloadCloud={() => {}} cloudEnabled={false} onBack={mock()} />);

    expect(screen.getByText("Backed")).toBeTruthy();
    expect(screen.queryByText(/Synced/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Upload to cloud/ })).toBeNull();
    expect(cloud.listCalls).toBe(0);
  });

  test("a failed upload keeps the world local and surfaces the error (never a false Synced)", async () => {
    cloud.createRejects = true; // creating the cloud row fails
    const user = userEvent.setup();
    createWorld("p1", "Local", "1", { uid: () => "wl" });
    render(<WorldSelect profile={PROFILE} onPlay={mock()} onDownloadCloud={() => {}} cloudEnabled={true} onBack={mock()} />);

    await user.click(await screen.findByRole("button", { name: "Upload to cloud" }));

    // The upload failed → the button reports it, the world was NOT linked, no false badge.
    expect(await screen.findByRole("button", { name: "Upload failed" })).toBeTruthy();
    expect(screen.queryByText(/Synced/)).toBeNull();
    expect(readWorlds().worlds.find((w) => w.id === "wl")?.cloudId).toBeUndefined();
  });
});
