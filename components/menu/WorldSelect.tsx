import { useCallback, useEffect, useState } from "react";
import CreateWorldForm from "@/components/menu/CreateWorldForm";
import MenuScreen from "@/components/menu/MenuScreen";
import type { Profile } from "@/lib/game/profiles";
import { GAME_MODE_PRESETS, type GameMode } from "@/lib/game/gameModes";
import { DIFFICULTY_PRESETS, type Difficulty } from "@/lib/game/difficulties";
import { createWorld, deleteWorld, linkWorldCloud, MAX_WORLD_NAME, renameWorld, WORLD_TYPE_PRESETS, worldsForProfile, type WorldMeta } from "@/lib/game/worlds";
import { worldSaves } from "@/lib/game/saveStore";
import { pushSave } from "@/lib/game/cloudSaves";
import type { WorldType } from "@/lib/world";
import { createOnlineWorld, listOnlineWorlds, type OnlineWorld } from "@/lib/online/onlineClient";

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
  /** Materialize a cloud save (sp-cloud) as a local world and open it. */
  onDownloadCloud: (world: OnlineWorld) => void;
  /** Cloud-save sync (upload / download) is offered — i.e. the shell knows a
   *  signed-in account. Logged-out Local Players get a purely local list with
   *  zero server calls. */
  cloudEnabled: boolean;
  /** Back to the profile list. */
  onBack: () => void;
};

/** A profile's world list: pick a world, or create / rename / delete one. */
export default function WorldSelect({ profile, onPlay, onDownloadCloud, cloudEnabled, onBack }: WorldSelectProps) {
  const [creating, setCreating] = useState(false);
  const [cloudWorldList, setCloudWorldList] = useState<OnlineWorld[] | null>(null);
  // Per-world (not single scalars): uploads run independently, so tracking one
  // id would re-enable another card's button mid-flight and allow a double-upload.
  const [uploading, setUploading] = useState<ReadonlySet<string>>(() => new Set());
  const [uploadError, setUploadError] = useState<ReadonlySet<string>>(() => new Set());

  // Cloud saves exist only for a signed-in account — offline-first: a
  // logged-out Local Player triggers no fetch and sees no cloud section.
  const refreshCloud = useCallback(() => {
    if (cloudEnabled) void listOnlineWorlds().then(setCloudWorldList);
  }, [cloudEnabled]);
  useEffect(() => refreshCloud(), [refreshCloud]);
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

  const worlds = worldsForProfile(profile.id);

  const without = (set: ReadonlySet<string>, id: string) => {
    const next = new Set(set);
    next.delete(id);
    return next;
  };

  // "Upload to cloud": create an sp-cloud world row, push the current save, and —
  // only if the push actually lands — link it so the card flips to "Synced".
  // Linking on a failed push would falsely claim the (empty) cloud row is synced.
  const uploadToCloud = (world: WorldMeta) => {
    setUploadError((prev) => without(prev, world.id));
    setUploading((prev) => new Set(prev).add(world.id));
    void Promise.all([
      worldSaves.read(world.id).catch(() => null),
      createOnlineWorld({
        name: world.name,
        seed: world.seed,
        worldType: world.worldType,
        gameMode: world.gameMode,
        difficulty: world.difficulty,
        hardcore: world.hardcore,
        kind: "sp-cloud"
      })
    ]).then(async ([save, cloud]) => {
      // A world with no local save yet has nothing to push — link it now and let
      // the first play autosave upload the blob.
      const pushed = cloud && save ? await pushSave(cloud.id, save) : "saved";
      if (cloud && pushed === "saved") {
        linkWorldCloud(world.id, cloud.id);
        refreshCloud();
      } else {
        setUploadError((prev) => new Set(prev).add(world.id)); // keep the world local — surface the failure
      }
      setUploading((prev) => without(prev, world.id));
    });
  };

  // Online (mp) rooms live in the account menu; here only the account's
  // sp-cloud saves not yet on this device become downloadable. Derived behind
  // cloudEnabled so a list fetched before a sign-out can't linger as stale UI.
  const linkedCloudIds = new Set(worlds.map((world) => world.cloudId).filter((id): id is string => Boolean(id)));
  const cloudWorlds = cloudEnabled ? (cloudWorldList?.filter((world) => world.kind === "sp-cloud" && !linkedCloudIds.has(world.id)) ?? []) : [];

  return (
    <MenuScreen title={`${profile.name} — Local Worlds`}>
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
                    {cloudEnabled &&
                      (world.cloudId ? (
                        <span className="menu-cloud-badge" title="This world syncs to your account across devices">
                          ☁ Synced
                        </span>
                      ) : (
                        <button
                          className="mc-button"
                          disabled={uploading.has(world.id)}
                          title="Sync this world to your account so it follows you across devices"
                          onClick={() => uploadToCloud(world)}
                        >
                          {uploading.has(world.id) ? "Uploading…" : uploadError.has(world.id) ? "Upload failed" : "Upload to cloud"}
                        </button>
                      ))}
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
      {cloudWorlds.length > 0 && (
        <section className="menu-online">
          <h3 className="menu-online-title">Cloud Saves</h3>
          <ul className="menu-list">
            {cloudWorlds.map((world) => (
              <li key={world.id} className="menu-card">
                <button className="menu-card-play" data-testid={`cloud-world-${world.id}`} onClick={() => onDownloadCloud(world)}>
                  <span className="menu-card-name">{world.name}</span>
                  <span className="menu-card-sub">Download to this device · Seed {world.seed}</span>
                </button>
              </li>
            ))}
          </ul>
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
