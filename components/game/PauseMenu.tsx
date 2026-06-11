import { useState } from "react";

type PauseMenuProps = {
  saveMessage: string;
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
  ["Debug overlay", "F3"],
  ["Emergency unstuck", "U"]
];

/**
 * The Minecraft-style game menu: shown while the engine is paused, with the
 * classic column of gray beveled buttons over a dimmed (frozen) world.
 */
export default function PauseMenu({ saveMessage, onBack, onSave, onLoad, onReset }: PauseMenuProps) {
  const [confirmingReset, setConfirmingReset] = useState(false);

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
