import { useState } from "react";
import { MAX_WORLD_NAME } from "@/lib/game/worlds";

type CreateWorldFormProps = {
  onCreate: (name: string, seed: string) => void;
  onCancel: () => void;
};

/** The new-world form: a name and an optional seed (blank seeds a random world). */
export default function CreateWorldForm({ onCreate, onCancel }: CreateWorldFormProps) {
  const [name, setName] = useState("");
  const [seed, setSeed] = useState("");

  return (
    <form
      className="menu-form"
      onSubmit={(event) => {
        event.preventDefault();
        onCreate(name, seed);
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
