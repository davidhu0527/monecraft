import { useState } from "react";
import PixelImg from "@/components/game/PixelImg";
import { MAX_PROFILE_NAME } from "@/lib/game/profiles";
import { DEFAULT_SKIN_ID, SKIN_PRESETS, type SkinId } from "@/lib/game/playerSkins";
import { skinPortraitUrl } from "@/lib/ui/sprites";

type CreateProfileFormProps = {
  onCreate: (name: string, skinId: SkinId) => void;
  onCancel: () => void;
};

/** The new-profile form: a name and a skin picker, reusing the pause-menu swatch grid. */
export default function CreateProfileForm({ onCreate, onCancel }: CreateProfileFormProps) {
  const [name, setName] = useState("");
  const [skinId, setSkinId] = useState<SkinId>(DEFAULT_SKIN_ID);

  return (
    <form
      className="menu-form"
      onSubmit={(event) => {
        event.preventDefault();
        onCreate(name, skinId);
      }}
    >
      <label className="menu-field">
        <span>Name</span>
        <input
          className="menu-input"
          type="text"
          value={name}
          maxLength={MAX_PROFILE_NAME}
          placeholder="Player"
          autoFocus
          onChange={(event) => setName(event.target.value)}
          aria-label="Profile name"
        />
      </label>
      <div className="pause-skins">
        <div className="pause-skins-title">Appearance</div>
        <div className="pause-skins-grid">
          {SKIN_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="skin-swatch"
              aria-pressed={preset.id === skinId}
              aria-label={`${preset.label} skin`}
              onClick={() => setSkinId(preset.id)}
            >
              <PixelImg src={skinPortraitUrl(preset.id)} alt="" size={32} aria-hidden />
              <span>{preset.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="menu-form-actions">
        <button type="submit" className="mc-button">
          Create
        </button>
        <button type="button" className="mc-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
