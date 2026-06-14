import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WorldSelect from "@/components/menu/WorldSelect";
import { createProfile, type Profile } from "@/lib/game/profiles";
import { createWorld, readWorlds } from "@/lib/game/worlds";

const PROFILE: Profile = { id: "p1", name: "Tester", skinId: "default", createdAt: 1 };

beforeEach(() => {
  localStorage.clear();
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
    render(<WorldSelect profile={PROFILE} onPlay={onPlay} onBack={mock()} />);

    expect(screen.queryByText("Hidden")).toBeNull();
    const names = screen.getAllByText(/Alpha|Beta/).map((n) => n.textContent);
    expect(names).toEqual(["Beta", "Alpha"]); // Beta played more recently

    await user.click(screen.getByTestId("world-wa"));
    expect(onPlay).toHaveBeenCalledWith("wa");
  });

  test("empty state invites creating the first world", () => {
    render(<WorldSelect profile={PROFILE} onPlay={mock()} onBack={mock()} />);
    expect(screen.getByText(/No worlds yet/i)).toBeTruthy();
  });

  test("creating a world persists it for the profile and enters it", async () => {
    const user = userEvent.setup();
    const onPlay = mock();
    render(<WorldSelect profile={PROFILE} onPlay={onPlay} onBack={mock()} />);

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
    render(<WorldSelect profile={PROFILE} onPlay={mock()} onBack={mock()} />);

    await user.click(screen.getByTestId("new-world"));
    await user.type(screen.getByLabelText("World name"), "Sky");
    await user.click(screen.getByRole("button", { name: "Islands world type" }));
    await user.click(screen.getByRole("button", { name: "Create World" }));

    expect(readWorlds().worlds[0].worldType).toBe("islands");
  });

  test("deleting a world removes it after confirmation", async () => {
    const user = userEvent.setup();
    createWorld("p1", "Doomed", "1", { uid: () => "wd" });
    render(<WorldSelect profile={PROFILE} onPlay={mock()} onBack={mock()} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete" })); // confirm
    expect(screen.queryByText("Doomed")).toBeNull();
    expect(readWorlds().worlds).toHaveLength(0);
  });

  test("renaming a world updates the manifest", async () => {
    const user = userEvent.setup();
    createWorld("p1", "Old", "1", { uid: () => "wr" });
    render(<WorldSelect profile={PROFILE} onPlay={mock()} onBack={mock()} />);

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
    render(<WorldSelect profile={PROFILE} onPlay={mock()} onBack={onBack} />);
    await user.click(screen.getByTestId("back-to-profiles"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
