import { useState } from "react";
import type { AudioSettings } from "@/lib/game/audio/audioDirector";
import { SKIN_PRESETS, type SkinId } from "@/lib/game/playerSkins";
import { skinPortraitUrl } from "@/lib/ui/sprites";
import PixelImg from "./PixelImg";

type PauseMenuProps = {
  saveMessage: string;
  audioSettings: AudioSettings;
  onAudioSettingsChange: (partial: Partial<AudioSettings>) => void;
  skinId: SkinId;
  onSkinChange: (id: SkinId) => void;
  onBack: () => void;
  onSave: () => void;
  onLoad: () => void;
  onReset: () => void;
};

const CONTROLS: Array<[string, string]> = [
  ["Move / Jump", "W A S D / Space"],
  ["Sprint / Crouch", "W + CapsLock / C"],
  ["Mine / Attack", "Hold left click / Left click"],
  ["Place block", "Right click or E"],
  ["Inventory", "I"],
  ["Eat food", "F"],
  ["Hotbar", "1-9"],
  ["Camera view", "V"],
  ["Debug overlay", "F3"],
  ["Emergency unstuck", "U"]
];

/**
 * The Minecraft-style game menu: shown while the engine is paused, with the
 * classic column of gray beveled buttons over a dimmed (frozen) world.
 */
export default function PauseMenu({
  saveMessage,
  audioSettings,
  onAudioSettingsChange,
  skinId,
  onSkinChange,
  onBack,
  onSave,
  onLoad,
  onReset
}: PauseMenuProps) {
  const [confirmingReset, setConfirmingReset] = useState(false);

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
        {saveMessage && <div className="pause-save-message">{saveMessage}</div>}
        <div className="pause-controls">
          {CONTROLS.map(([action, keys]) => (
            <div key={action} className="pause-controls-row">
              <span>{action}</span>
              <span>{keys}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
