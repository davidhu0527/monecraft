import { useCallback, useEffect, useState } from "react";
import CreateWorldForm from "@/components/menu/CreateWorldForm";
import MenuScreen from "@/components/menu/MenuScreen";
import type { Profile } from "@/lib/game/profiles";
import { GAME_MODE_PRESETS, type GameMode } from "@/lib/game/gameModes";
import { DIFFICULTY_PRESETS, type Difficulty } from "@/lib/game/difficulties";
import { createWorld, deleteWorld, MAX_WORLD_NAME, renameWorld, WORLD_TYPE_PRESETS, worldsForProfile } from "@/lib/game/worlds";
import type { WorldType } from "@/lib/world";
import { onlineUsed } from "@/lib/auth/client";
import { createInviteLink, createOnlineWorld, listOnlineWorlds, type OnlineWorld } from "@/lib/online/onlineClient";
import { resolveSeed } from "@/lib/game/worlds";

/** Short label for a world type (the default type is left unlabelled on cards). */
function worldTypeLabel(id: WorldType): string {
  return WORLD_TYPE_PRESETS.find((preset) => preset.id === id)?.label ?? id;
}

/** Short label for a game mode (survival is left unlabelled on cards). */
function gameModeLabel(id: GameMode): string {
  return GAME_MODE_PRESETS.find((preset) => preset.id === id)?.label ?? id;
}

/** Short label for a difficulty (normal is left unlabelled on cards). */
function difficultyLabel(id: Difficulty): string {
  return DIFFICULTY_PRESETS.find((preset) => preset.id === id)?.label ?? id;
}

type WorldSelectProps = {
  profile: Profile;
  /** Enter a world (the shell records last-played and boots it). */
  onPlay: (worldId: string) => void;
  /** Join an online (server-hosted) world. */
  onPlayOnline: (world: OnlineWorld) => void;
  /** Back to the profile list. */
  onBack: () => void;
};

/** A profile's world list: pick a world, or create / rename / delete one. */
export default function WorldSelect({ profile, onPlay, onPlayOnline, onBack }: WorldSelectProps) {
  const [creating, setCreating] = useState(false);
  const [creatingOnline, setCreatingOnline] = useState(false);
  const [onlineWorlds, setOnlineWorlds] = useState<OnlineWorld[] | null>(null);
  const [inviteCopied, setInviteCopied] = useState<string | null>(null);

  // Online worlds appear only once this browser has used online features —
  // offline-first: no fetch, no section, no account until the player opts in.
  const refreshOnline = useCallback(() => {
    if (onlineUsed()) void listOnlineWorlds().then(setOnlineWorlds);
  }, []);
  useEffect(() => refreshOnline(), [refreshOnline]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  if (creating) {
    return (
      <MenuScreen title={`${profile.name} — New World`}>
        <CreateWorldForm
          onCreate={(name, seed, worldType, gameMode, difficulty, hardcore) => {
            const world = createWorld(profile.id, name, seed, { worldType, gameMode, difficulty, hardcore });
            setCreating(false);
            onPlay(world.id); // straight into the freshly created world
          }}
          onCancel={() => setCreating(false)}
        />
      </MenuScreen>
    );
  }

  if (creatingOnline) {
    return (
      <MenuScreen title={`${profile.name} — New Online World`}>
        <CreateWorldForm
          onCreate={(name, seed, worldType, gameMode, difficulty, hardcore) => {
            // Same form, different home: the world row lives on the server and
            // the game server hosts it — friends join by invite link.
            void createOnlineWorld({ name, seed: resolveSeed(seed), worldType, gameMode, difficulty, hardcore }).then((world) => {
              setCreatingOnline(false);
              if (world) onPlayOnline(world);
            });
          }}
          onCancel={() => setCreatingOnline(false)}
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
                      {world.hardcore ? `Hardcore · ` : ""}
                      {world.gameMode !== "survival" ? `${gameModeLabel(world.gameMode)} · ` : ""}
                      {!world.hardcore && world.difficulty !== "normal" ? `${difficultyLabel(world.difficulty)} · ` : ""}
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
      {onlineWorlds !== null && (
        <section className="menu-online">
          <h3 className="menu-online-title">Online Worlds</h3>
          {onlineWorlds.length === 0 ? (
            <p className="menu-empty">No online worlds yet — create one and share the invite link.</p>
          ) : (
            <ul className="menu-list">
              {onlineWorlds.map((world) => (
                <li key={world.id} className="menu-card">
                  <button className="menu-card-play" data-testid={`online-world-${world.id}`} onClick={() => onPlayOnline(world)}>
                    <span className="menu-card-name">{world.name}</span>
                    <span className="menu-card-sub">
                      {world.role === "owner" ? "Your world" : "Joined"} · Seed {world.seed}
                    </span>
                  </button>
                  {world.role === "owner" && (
                    <div className="menu-card-actions">
                      <button
                        className="mc-button"
                        onClick={() => {
                          void createInviteLink(world.id).then((link) => {
                            if (!link) return;
                            void navigator.clipboard?.writeText(link).catch(() => {});
                            setInviteCopied(world.id);
                          });
                        }}
                      >
                        {inviteCopied === world.id ? "Link copied!" : "Copy invite"}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <button className="mc-button" data-testid="new-online-world" onClick={() => setCreatingOnline(true)}>
            New Online World
          </button>
        </section>
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
