import { useState } from "react";
import type { AudioSettings } from "@/lib/game/audio/audioDirector";
import { GAME_MODE_PRESETS, type GameMode } from "@/lib/game/gameModes";
import { SKIN_PRESETS, type SkinId } from "@/lib/game/playerSkins";
import { skinPortraitUrl } from "@/lib/ui/sprites";
import PixelImg from "./PixelImg";

type PauseMenuProps = {
  saveMessage: string;
  audioSettings: AudioSettings;
  onAudioSettingsChange: (partial: Partial<AudioSettings>) => void;
  gameMode: GameMode;
  onGameModeChange: (mode: GameMode) => void;
  skinId: SkinId;
  onSkinChange: (id: SkinId) => void;
  onBack: () => void;
  onSave: () => void;
  onLoad: () => void;
  onReset: () => void;
  onQuitToWorlds: () => void;
};

type PauseTab = "game" | "options" | "controls";

const TABS: ReadonlyArray<{ id: PauseTab; label: string }> = [
  { id: "game", label: "Game" },
  { id: "options", label: "Options" },
  { id: "controls", label: "Controls" }
];

const CONTROLS: Array<[string, string]> = [
  ["Move / Jump", "W A S D / Space"],
  ["Sprint / Crouch", "W + CapsLock / C"],
  ["Mine / Attack", "Hold left click / Left click"],
  ["Place / interact / throw spear", "Right click or E"],
  ["Inventory", "I"],
  ["Eat food", "F"],
  ["Hotbar", "1-9"],
  ["Toggle flight (Creative)", "Double-tap Space"],
  ["Fly up / down", "Space / C (while flying)"],
  ["Camera view", "V"],
  ["Debug overlay", "F3"],
  ["Emergency unstuck", "Shift + U"]
];

/**
 * The Minecraft-style game menu: shown while the engine is paused, over a dimmed
 * (frozen) world. "Back to Game" stays pinned on top; the rest is split across
 * three tabs — Game (save/load/reset/quit + game mode), Options (sound +
 * appearance), and Controls (the key reference) — so no single view is a long
 * scroll.
 */
export default function PauseMenu({
  saveMessage,
  audioSettings,
  onAudioSettingsChange,
  gameMode,
  onGameModeChange,
  skinId,
  onSkinChange,
  onBack,
  onSave,
  onLoad,
  onReset,
  onQuitToWorlds
}: PauseMenuProps) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [tab, setTab] = useState<PauseTab>("game");

  const volumeSlider = (label: string, value: number, onValue: (volume: number) => void) => (
    <label className="pause-sound-row">
      <span>{label}</span>
      <input
        className="mc-slider"
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(event) => onValue(Math.max(0, Math.min(1, Number(event.target.value) / 100)))}
        aria-label={`${label} volume`}
      />
    </label>
  );

  return (
    <div className="pause-overlay">
      <div className="pause-menu">
        <div className="pause-title">Game Menu</div>
        <button className="mc-button" onClick={onBack}>
          Back to Game
        </button>

        <div className="pause-tabs">
          {TABS.map((entry) => (
            <button key={entry.id} className="mc-button pause-tab" aria-pressed={tab === entry.id} onClick={() => setTab(entry.id)}>
              {entry.label}
            </button>
          ))}
        </div>

        <div className="pause-panel">
          {tab === "game" && (
            <>
              <button className="mc-button" onClick={onSave}>
                Save Game
              </button>
              <button className="mc-button" onClick={onLoad}>
                Load Save
              </button>
              {confirmingReset ? (
                <div className="pause-reset-row">
                  <button className="mc-button danger" onClick={onReset}>
                    Confirm Reset
                  </button>
                  <button className="mc-button" onClick={() => setConfirmingReset(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button className="mc-button" onClick={() => setConfirmingReset(true)}>
                  Reset World
                </button>
              )}
              <button className="mc-button" onClick={onQuitToWorlds}>
                Save &amp; Quit to Worlds
              </button>
              <div className="pause-modes">
                <div className="pause-skins-title">Game Mode</div>
                <div className="pause-modes-grid">
                  {GAME_MODE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      className="mc-button mode-option"
                      aria-pressed={preset.id === gameMode}
                      aria-label={`${preset.label} mode`}
                      onClick={() => onGameModeChange(preset.id)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === "options" && (
            <>
              <div className="pause-sound">
                {volumeSlider("Sound", audioSettings.master, (volume) => onAudioSettingsChange({ master: volume }))}
                {volumeSlider("Music", audioSettings.music, (volume) => onAudioSettingsChange({ music: volume }))}
                <button className="mc-button" aria-pressed={audioSettings.muted} onClick={() => onAudioSettingsChange({ muted: !audioSettings.muted })}>
                  {audioSettings.muted ? "Unmute Sound" : "Mute Sound"}
                </button>
              </div>
              <div className="pause-skins">
                <div className="pause-skins-title">Appearance</div>
                <div className="pause-skins-grid">
                  {SKIN_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      className="skin-swatch"
                      aria-pressed={preset.id === skinId}
                      aria-label={`${preset.label} skin`}
                      onClick={() => onSkinChange(preset.id)}
                    >
                      <PixelImg src={skinPortraitUrl(preset.id)} alt="" size={32} aria-hidden />
                      <span>{preset.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === "controls" && (
            <div className="pause-controls">
              {CONTROLS.map(([action, keys]) => (
                <div key={action} className="pause-controls-row">
                  <span>{action}</span>
                  <span>{keys}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {saveMessage && <div className="pause-save-message">{saveMessage}</div>}
      </div>
    </div>
  );
}
