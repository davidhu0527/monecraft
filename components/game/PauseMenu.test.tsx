import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PauseMenu from "@/components/game/PauseMenu";
import { DEFAULT_AUDIO_SETTINGS } from "@/lib/game/audio/audioDirector";
import type { GameMode } from "@/lib/game/gameModes";
import type { Difficulty } from "@/lib/game/difficulties";
import { DEFAULT_SKIN_ID, SKIN_PRESETS } from "@/lib/game/playerSkins";

function renderMenu(overrides: Partial<Parameters<typeof PauseMenu>[0]> = {}) {
  const props = {
    saveMessage: "",
    audioSettings: DEFAULT_AUDIO_SETTINGS,
    onAudioSettingsChange: mock(),
    gameMode: "survival" as GameMode,
    onGameModeChange: mock(),
    difficulty: "normal" as Difficulty,
    onDifficultyChange: mock(),
    hardcore: false,
    skinId: DEFAULT_SKIN_ID,
    onSkinChange: mock(),
    onBack: mock(),
    onSave: mock(),
    onLoad: mock(),
    onReset: mock(),
    onQuitToWorlds: mock(),
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
    await user.click(screen.getByRole("button", { name: "Save & Quit to Worlds" }));
    expect(props.onBack).toHaveBeenCalledTimes(1);
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onLoad).toHaveBeenCalledTimes(1);
    expect(props.onQuitToWorlds).toHaveBeenCalledTimes(1);
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

  test("the game-mode buttons switch mode", async () => {
    const user = userEvent.setup();
    const props = renderMenu({ gameMode: "survival" });
    expect(screen.getByRole("button", { name: "Survival mode" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Creative mode" }));
    expect(props.onGameModeChange).toHaveBeenCalledWith("creative");
  });

  test("the difficulty buttons switch difficulty", async () => {
    const user = userEvent.setup();
    const props = renderMenu({ difficulty: "normal" });
    expect(screen.getByRole("button", { name: "Normal difficulty" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Peaceful difficulty" }));
    expect(props.onDifficultyChange).toHaveBeenCalledWith("peaceful");
  });

  test("hardcore locks the mode and difficulty switchers", async () => {
    const user = userEvent.setup();
    const props = renderMenu({ hardcore: true, gameMode: "survival", difficulty: "hard" });
    const creative = screen.getByRole("button", { name: "Creative mode" });
    const peaceful = screen.getByRole("button", { name: "Peaceful difficulty" });
    expect((creative as HTMLButtonElement).disabled).toBe(true);
    expect((peaceful as HTMLButtonElement).disabled).toBe(true);
    await user.click(creative);
    await user.click(peaceful);
    expect(props.onGameModeChange).not.toHaveBeenCalled();
    expect(props.onDifficultyChange).not.toHaveBeenCalled();
  });

  test("volume sliders report normalized values", () => {
    const props = renderMenu({ audioSettings: { master: 0.8, music: 0.6, muted: false } });
    fireEvent.click(screen.getByRole("button", { name: "Options" }));
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
    await user.click(screen.getByRole("button", { name: "Options" }));
    await user.click(screen.getByRole("button", { name: "Unmute Sound" }));
    expect(props.onAudioSettingsChange).toHaveBeenCalledWith({ muted: false });
  });

  test("shows every skin preset with only the active one pressed", () => {
    renderMenu({ skinId: "knight" });
    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    const swatches = screen.getAllByRole("button", { name: /skin$/ });
    expect(swatches).toHaveLength(SKIN_PRESETS.length);
    for (const swatch of swatches) {
      const pressed = swatch.getAttribute("aria-pressed");
      expect(pressed).toBe(swatch.getAttribute("aria-label") === "Knight skin" ? "true" : "false");
    }
  });

  test("clicking a skin swatch reports its preset id", async () => {
    const user = userEvent.setup();
    const props = renderMenu();
    await user.click(screen.getByRole("button", { name: "Options" }));
    await user.click(screen.getByRole("button", { name: "Robot skin" }));
    expect(props.onSkinChange).toHaveBeenCalledTimes(1);
    expect(props.onSkinChange).toHaveBeenCalledWith("robot");
  });

  test("tabs switch the visible section", async () => {
    const user = userEvent.setup();
    renderMenu();
    // Game is the default tab: actions show, Options/Controls content is absent.
    expect(screen.getByRole("button", { name: "Save Game" })).toBeTruthy();
    expect(screen.queryByLabelText("Sound volume")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Options" }));
    expect(screen.getByLabelText("Sound volume")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save Game" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Controls" }));
    expect(screen.getByText("Inventory")).toBeTruthy();
    expect(screen.queryByLabelText("Sound volume")).toBeNull();
  });
});
