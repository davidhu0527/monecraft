import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PauseMenu from "@/components/game/PauseMenu";
import { DEFAULT_AUDIO_SETTINGS } from "@/lib/game/audio/audioDirector";

function renderMenu(overrides: Partial<Parameters<typeof PauseMenu>[0]> = {}) {
  const props = {
    saveMessage: "",
    audioSettings: DEFAULT_AUDIO_SETTINGS,
    onAudioSettingsChange: mock(),
    onBack: mock(),
    onSave: mock(),
    onLoad: mock(),
    onReset: mock(),
    ...overrides
  };
  render(<PauseMenu {...props} />);
  return props;
}

describe("PauseMenu", () => {
  test("buttons dispatch their callbacks", async () => {
    const user = userEvent.setup();
    const props = renderMenu();
    await user.click(screen.getByRole("button", { name: "Back to Game" }));
    await user.click(screen.getByRole("button", { name: "Save Game" }));
    await user.click(screen.getByRole("button", { name: "Load Save" }));
    expect(props.onBack).toHaveBeenCalledTimes(1);
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onLoad).toHaveBeenCalledTimes(1);
  });

  test("reset requires a confirmation step", async () => {
    const user = userEvent.setup();
    const props = renderMenu();
    await user.click(screen.getByRole("button", { name: "Reset World" }));
    expect(props.onReset).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm Reset" }));
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  test("cancel backs out of the reset confirmation", async () => {
    const user = userEvent.setup();
    const props = renderMenu();
    await user.click(screen.getByRole("button", { name: "Reset World" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Reset World" })).toBeTruthy();
    expect(props.onReset).not.toHaveBeenCalled();
  });

  test("shows the transient save message", () => {
    renderMenu({ saveMessage: "Saved" });
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  test("volume sliders report normalized values", () => {
    const props = renderMenu({ audioSettings: { master: 0.8, music: 0.6, muted: false } });
    const master = screen.getByLabelText("Sound volume") as HTMLInputElement;
    expect(master.value).toBe("80");
    fireEvent.change(master, { target: { value: "35" } });
    expect(props.onAudioSettingsChange).toHaveBeenCalledWith({ master: 0.35 });
    fireEvent.change(screen.getByLabelText("Music volume"), { target: { value: "0" } });
    expect(props.onAudioSettingsChange).toHaveBeenCalledWith({ music: 0 });
  });

  test("the mute button toggles by current state", async () => {
    const user = userEvent.setup();
    const props = renderMenu({ audioSettings: { master: 1, music: 1, muted: true } });
    await user.click(screen.getByRole("button", { name: "Unmute Sound" }));
    expect(props.onAudioSettingsChange).toHaveBeenCalledWith({ muted: false });
  });
});
