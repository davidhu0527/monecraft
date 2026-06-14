import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProfileSelect from "@/components/menu/ProfileSelect";
import { createProfile, readProfiles } from "@/lib/game/profiles";

beforeEach(() => localStorage.clear());

describe("ProfileSelect", () => {
  test("lists existing profiles and plays the chosen one", async () => {
    const user = userEvent.setup();
    const alice = createProfile("Alice", "alex");
    createProfile("Bob", "robot");
    const onPlay = mock();
    render(<ProfileSelect onPlay={onPlay} />);

    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("Bob")).toBeTruthy();

    await user.click(screen.getByTestId(`profile-${alice.id}`));
    expect(onPlay).toHaveBeenCalledWith(alice.id);
  });

  test("with no profiles it opens straight into the create form (no cancel)", () => {
    render(<ProfileSelect onPlay={mock()} />);
    expect(screen.getByText("Create Your Profile")).toBeTruthy();
    expect(screen.getByLabelText("Profile name")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  test("first-run create enters the new profile", async () => {
    const user = userEvent.setup();
    const onPlay = mock();
    render(<ProfileSelect onPlay={onPlay} />);
    await user.type(screen.getByLabelText("Profile name"), "Solo");
    await user.click(screen.getByRole("button", { name: "Create" }));
    const created = readProfiles().profiles.find((p) => p.name === "Solo")!;
    expect(onPlay).toHaveBeenCalledWith(created.id);
  });

  test("adding another profile from the list persists it and enters it", async () => {
    const user = userEvent.setup();
    createProfile("Existing", "default"); // so the list (not the first-run form) renders
    const onPlay = mock();
    render(<ProfileSelect onPlay={onPlay} />);

    await user.click(screen.getByTestId("new-profile"));
    await user.type(screen.getByLabelText("Profile name"), "Charlie");
    await user.click(screen.getByRole("button", { name: "Create" }));

    const profiles = readProfiles().profiles;
    expect(profiles.map((p) => p.name)).toContain("Charlie");
    const created = profiles.find((p) => p.name === "Charlie")!;
    expect(onPlay).toHaveBeenCalledWith(created.id);
  });

  test("deleting a profile removes it after confirmation", async () => {
    const user = userEvent.setup();
    createProfile("Doomed", "default");
    render(<ProfileSelect onPlay={mock()} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete" })); // confirm
    expect(screen.queryByText("Doomed")).toBeNull();
    expect(readProfiles().profiles).toHaveLength(0);
  });

  test("renaming a profile updates the manifest", async () => {
    const user = userEvent.setup();
    createProfile("Old", "default");
    render(<ProfileSelect onPlay={mock()} />);

    await user.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByLabelText("Rename profile");
    await user.clear(input);
    await user.type(input, "Fresh");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(readProfiles().profiles[0].name).toBe("Fresh");
    expect(screen.getByText("Fresh")).toBeTruthy();
  });
});
