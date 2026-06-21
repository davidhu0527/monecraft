import { useState } from "react";
import CreateWorldForm from "@/components/menu/CreateWorldForm";
import MenuScreen from "@/components/menu/MenuScreen";
import type { Profile } from "@/lib/game/profiles";
import { GAME_MODE_PRESETS, type GameMode } from "@/lib/game/gameModes";
import { createWorld, deleteWorld, MAX_WORLD_NAME, renameWorld, WORLD_TYPE_PRESETS, worldsForProfile } from "@/lib/game/worlds";
import type { WorldType } from "@/lib/world";

/** Short label for a world type (the default type is left unlabelled on cards). */
function worldTypeLabel(id: WorldType): string {
  return WORLD_TYPE_PRESETS.find((preset) => preset.id === id)?.label ?? id;
}

/** Short label for a game mode (survival is left unlabelled on cards). */
function gameModeLabel(id: GameMode): string {
  return GAME_MODE_PRESETS.find((preset) => preset.id === id)?.label ?? id;
}

type WorldSelectProps = {
  profile: Profile;
  /** Enter a world (the shell records last-played and boots it). */
  onPlay: (worldId: string) => void;
  /** Back to the profile list. */
  onBack: () => void;
};

/** A profile's world list: pick a world, or create / rename / delete one. */
export default function WorldSelect({ profile, onPlay, onBack }: WorldSelectProps) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  if (creating) {
    return (
      <MenuScreen title={`${profile.name} — New World`}>
        <CreateWorldForm
          onCreate={(name, seed, worldType, gameMode) => {
            const world = createWorld(profile.id, name, seed, { worldType, gameMode });
            setCreating(false);
            onPlay(world.id); // straight into the freshly created world
          }}
          onCancel={() => setCreating(false)}
        />
      </MenuScreen>
    );
  }

  const worlds = worldsForProfile(profile.id);

  return (
    <MenuScreen title={`${profile.name} — Worlds`}>
      {worlds.length === 0 ? (
        <p className="menu-empty">No worlds yet. Create your first world.</p>
      ) : (
        <ul className="menu-list">
          {worlds.map((world) => (
            <li key={world.id} className="menu-card">
              {editingId === world.id ? (
                <form
                  className="menu-rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    renameWorld(world.id, editName);
                    setEditingId(null); // re-render re-reads the manifest
                  }}
                >
                  <input
                    className="menu-input"
                    value={editName}
                    maxLength={MAX_WORLD_NAME}
                    autoFocus
                    aria-label="Rename world"
                    onChange={(event) => setEditName(event.target.value)}
                  />
                  <button type="submit" className="mc-button">
                    Save
                  </button>
                  <button type="button" className="mc-button" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </form>
              ) : confirmingDeleteId === world.id ? (
                <div className="menu-confirm">
                  <span>Delete “{world.name}”? This cannot be undone.</span>
                  <div className="menu-confirm-actions">
                    <button
                      className="mc-button danger"
                      onClick={() => {
                        deleteWorld(world.id);
                        setConfirmingDeleteId(null); // re-render re-reads the manifest
                      }}
                    >
                      Delete
                    </button>
                    <button className="mc-button" onClick={() => setConfirmingDeleteId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button className="menu-card-play" data-testid={`world-${world.id}`} onClick={() => onPlay(world.id)}>
                    <span className="menu-card-name">{world.name}</span>
                    <span className="menu-card-sub">
                      {world.gameMode !== "survival" ? `${gameModeLabel(world.gameMode)} · ` : ""}
                      {world.worldType !== "default" ? `${worldTypeLabel(world.worldType)} · ` : ""}Seed {world.seed}
                    </span>
                  </button>
                  <div className="menu-card-actions">
                    <button
                      className="mc-button"
                      onClick={() => {
                        setEditName(world.name);
                        setEditingId(world.id);
                      }}
                    >
                      Rename
                    </button>
                    <button className="mc-button" onClick={() => setConfirmingDeleteId(world.id)}>
                      Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="menu-bottom-row">
        <button className="mc-button" data-testid="back-to-profiles" onClick={onBack}>
          Back
        </button>
        <button className="mc-button menu-primary" data-testid="new-world" onClick={() => setCreating(true)}>
          New World
        </button>
      </div>
    </MenuScreen>
  );
}
