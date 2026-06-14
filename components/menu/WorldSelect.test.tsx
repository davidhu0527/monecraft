import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WorldSelect from "@/components/menu/WorldSelect";
import type { Profile } from "@/lib/game/profiles";
import { createWorld, readWorlds } from "@/lib/game/worlds";

const PROFILE: Profile = { id: "p1", name: "Tester", skinId: "default", createdAt: 1 };

beforeEach(() => localStorage.clear());

describe("WorldSelect", () => {
  test("lists only this profile's worlds, most-recent first, and plays one", async () => {
    const user = userEvent.setup();
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

  test("deleting a world removes it after confirmation", async () => {
    const user = userEvent.setup();
    createWorld("p1", "Doomed", "1", { uid: () => "wd" });
    render(<WorldSelect profile={PROFILE} onPlay={mock()} onBack={mock()} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete" })); // confirm
    expect(screen.queryByText("Doomed")).toBeNull();
    expect(readWorlds().worlds).toHaveLength(0);
  });

  test("back returns to the profile list", async () => {
    const user = userEvent.setup();
    const onBack = mock();
    render(<WorldSelect profile={PROFILE} onPlay={mock()} onBack={onBack} />);
    await user.click(screen.getByTestId("back-to-profiles"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
