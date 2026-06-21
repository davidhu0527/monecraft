import { useState } from "react";
import { GAME_MODE_PRESETS, type GameMode } from "@/lib/game/gameModes";
import { MAX_WORLD_NAME, WORLD_TYPE_PRESETS } from "@/lib/game/worlds";
import type { WorldType } from "@/lib/world";

type CreateWorldFormProps = {
  onCreate: (name: string, seed: string, worldType: WorldType, gameMode: GameMode) => void;
  onCancel: () => void;
};

/** The new-world form: a name, a game mode, a world type, and an optional seed (blank = random). */
export default function CreateWorldForm({ onCreate, onCancel }: CreateWorldFormProps) {
  const [name, setName] = useState("");
  const [seed, setSeed] = useState("");
  const [worldType, setWorldType] = useState<WorldType>("default");
  const [gameMode, setGameMode] = useState<GameMode>("survival");

  return (
    <form
      className="menu-form"
      onSubmit={(event) => {
        event.preventDefault();
        onCreate(name, seed, worldType, gameMode);
      }}
    >
      <label className="menu-field">
        <span>Name</span>
        <input
          className="menu-input"
          type="text"
          value={name}
          maxLength={MAX_WORLD_NAME}
          placeholder="New World"
          autoFocus
          onChange={(event) => setName(event.target.value)}
          aria-label="World name"
        />
      </label>
      <div className="menu-field">
        <span>Game Mode</span>
        <div className="world-type-grid">
          {GAME_MODE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="world-type-option"
              aria-pressed={preset.id === gameMode}
              aria-label={`${preset.label} mode`}
              onClick={() => setGameMode(preset.id)}
            >
              <span className="world-type-label">{preset.label}</span>
              <span className="world-type-blurb">{preset.blurb}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="menu-field">
        <span>World Type</span>
        <div className="world-type-grid">
          {WORLD_TYPE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="world-type-option"
              aria-pressed={preset.id === worldType}
              aria-label={`${preset.label} world type`}
              onClick={() => setWorldType(preset.id)}
            >
              <span className="world-type-label">{preset.label}</span>
              <span className="world-type-blurb">{preset.blurb}</span>
            </button>
          ))}
        </div>
      </div>
      <label className="menu-field">
        <span>Seed</span>
        <input
          className="menu-input"
          type="text"
          value={seed}
          placeholder="Leave blank for random"
          onChange={(event) => setSeed(event.target.value)}
          aria-label="World seed"
        />
      </label>
      <div className="menu-form-actions">
        <button type="submit" className="mc-button">
          Create World
        </button>
        <button type="button" className="mc-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
