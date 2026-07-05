"use client";

import { useCallback, useEffect, useState } from "react";
import CreateWorldForm from "@/components/menu/CreateWorldForm";
import MenuScreen from "@/components/menu/MenuScreen";
import { GAME_MODE_PRESETS, type GameMode } from "@/lib/game/gameModes";
import { DIFFICULTY_PRESETS, type Difficulty } from "@/lib/game/difficulties";
import { MAX_WORLDS_PER_PROFILE } from "@/lib/game/config";
import { resolveSeed, WORLD_TYPE_PRESETS } from "@/lib/game/worlds";
import type { WorldType } from "@/lib/world";
import { createOnlineWorld, deleteOnlineWorld, listOnlineWorlds, createInviteLink, revokeInviteLinks, type OnlineWorld } from "@/lib/online/onlineClient";
import type { OnlineProfile } from "@/lib/online/profilesClient";

/**
 * An account profile's worlds: the account-mode counterpart to WorldSelect.
 * Two sections — Online Worlds (server-hosted mp rooms: this profile's own
 * plus every world the account joined by invite; invite links for owned ones)
 * and Singleplayer (sp-cloud worlds: played entirely client-side, saves
 * synced to the account so any signed-in device can continue them). Owned
 * worlds of both kinds share the MAX_WORLDS_PER_PROFILE quota.
 */

function worldTypeLabel(id: WorldType): string {
  return WORLD_TYPE_PRESETS.find((preset) => preset.id === id)?.label ?? id;
}
function gameModeLabel(id: GameMode): string {
  return GAME_MODE_PRESETS.find((preset) => preset.id === id)?.label ?? id;
}
function difficultyLabel(id: Difficulty): string {
  return DIFFICULTY_PRESETS.find((preset) => preset.id === id)?.label ?? id;
}

/** The shared "mode · difficulty · type · seed" tail of a world card. */
function worldCardDetails(world: OnlineWorld): string {
  return (
    (world.hardcore ? " Hardcore ·" : "") +
    (world.gameMode !== "survival" ? ` ${gameModeLabel(world.gameMode as GameMode)} ·` : "") +
    (!world.hardcore && world.difficulty !== "normal" ? ` ${difficultyLabel(world.difficulty as Difficulty)} ·` : "") +
    (world.worldType !== "default" ? ` ${worldTypeLabel(world.worldType as WorldType)} ·` : "") +
    ` Seed ${world.seed}`
  );
}

type OnlineWorldSelectProps = {
  profile: OnlineProfile;
  /** Join a server-hosted (mp) world as this profile. */
  onPlayOnline: (world: OnlineWorld) => void;
  /** Open a singleplayer (sp-cloud) world — client-side engine, synced save. */
  onPlayCloud: (world: OnlineWorld) => void;
  /** Back to the account's profile list. */
  onBack: () => void;
};

export default function OnlineWorldSelect({ profile, onPlayOnline, onPlayCloud, onBack }: OnlineWorldSelectProps) {
  const [creating, setCreating] = useState<"mp" | "sp" | null>(null);
  const [worlds, setWorlds] = useState<OnlineWorld[] | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invitesRevoked, setInvitesRevoked] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deleteFailedId, setDeleteFailedId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void listOnlineWorlds().then((all) => setWorlds(all));
  }, []);
  useEffect(() => refresh(), [refresh]);

  // Online rooms: this profile's own, plus joined ones. Joined worlds appear
  // under every profile: membership is account-level and their profileId is
  // the host's, so an owned-only filter would hide them everywhere.
  const mpWorlds = (worlds ?? []).filter((world) => world.kind === "mp" && (world.profileId === profile.id || world.role === "member"));
  // Singleplayer: this profile's own, plus the account-level ones uploaded
  // from the local menus (profileId null) — those show under every profile.
  const spWorlds = (worlds ?? []).filter((world) => world.kind === "sp-cloud" && (world.profileId === profile.id || world.profileId === null));
  // The server counts every world owned by this profile — both kinds — so the
  // client must too, or the buttons would enable creates the server refuses.
  const atCap = (worlds ?? []).filter((world) => world.profileId === profile.id).length >= MAX_WORLDS_PER_PROFILE;
  const capTitle = atCap ? `Profile world limit reached (${MAX_WORLDS_PER_PROFILE})` : undefined;

  if (creating) {
    const singleplayer = creating === "sp";
    return (
      <MenuScreen title={`${profile.name} — ${singleplayer ? "New Singleplayer World" : "New Online World"}`}>
        {createError && <p className="account-error">{createError}</p>}
        <CreateWorldForm
          onCreate={(name, seed, worldType, gameMode, difficulty, hardcore) => {
            setCreateError(null);
            void createOnlineWorld({
              name,
              seed: resolveSeed(seed),
              worldType,
              gameMode,
              difficulty,
              hardcore,
              ...(singleplayer ? { kind: "sp-cloud" as const } : {}),
              profileId: profile.id
            }).then((world) => {
              if (world) {
                setCreating(null);
                if (singleplayer) onPlayCloud(world);
                else onPlayOnline(world);
              } else {
                setCreateError("Couldn't create the world — are you online, and under your world limit?");
              }
            });
          }}
          onCancel={() => setCreating(null)}
        />
      </MenuScreen>
    );
  }

  return (
    <MenuScreen title={`${profile.name} — Worlds`}>
      {worlds === null ? (
        <p className="menu-empty">Loading…</p>
      ) : (
        <>
          <section className="menu-online">
            <h3 className="menu-online-title">Online Worlds</h3>
            {mpWorlds.length === 0 ? (
              <p className="menu-empty">No online worlds yet — create one and share the invite link.</p>
            ) : (
              <ul className="menu-list">
                {mpWorlds.map((world) => (
                  <li key={world.id} className="menu-card">
                    <button className="menu-card-play" data-testid={`online-world-${world.id}`} onClick={() => onPlayOnline(world)}>
                      <span className="menu-card-name">{world.name}</span>
                      <span className="menu-card-sub">
                        {world.role === "owner" ? "Your world" : "Joined"} ·{worldCardDetails(world)}
                      </span>
                    </button>
                    {world.role === "owner" && (
                      <div className="menu-card-actions">
                        <button
                          className="mc-button"
                          onClick={() => {
                            setInvitesRevoked(null);
                            setInviteError(null);
                            setInviteCopied(null);
                            void createInviteLink(world.id).then((link) => {
                              const clipboard = navigator.clipboard;
                              if (!link || !clipboard) return void setInviteError(world.id);
                              void clipboard
                                .writeText(link)
                                .then(() => setInviteCopied(world.id))
                                .catch(() => setInviteError(world.id));
                            });
                          }}
                        >
                          {inviteError === world.id ? "Copy failed" : inviteCopied === world.id ? "Link copied!" : "Copy invite"}
                        </button>
                        <button
                          className="mc-button"
                          title="Invalidate every invite link you've shared for this world"
                          onClick={() => {
                            setInviteCopied(null);
                            setInviteError(null);
                            void revokeInviteLinks(world.id).then((count) => {
                              if (count !== null) setInvitesRevoked(world.id);
                            });
                          }}
                        >
                          {invitesRevoked === world.id ? "Links revoked" : "Revoke links"}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="menu-online">
            <h3 className="menu-online-title">Singleplayer</h3>
            {spWorlds.length === 0 ? (
              <p className="menu-empty">No singleplayer worlds yet — they sync to your account and follow you across devices.</p>
            ) : (
              <ul className="menu-list">
                {spWorlds.map((world) => (
                  <li key={world.id} className="menu-card">
                    {confirmingDeleteId === world.id ? (
                      <div className="menu-confirm">
                        <span>Delete “{world.name}” and its cloud save? This cannot be undone.</span>
                        <div className="menu-confirm-actions">
                          <button
                            className="mc-button danger"
                            onClick={() =>
                              void deleteOnlineWorld(world.id).then((deleted) => {
                                setConfirmingDeleteId(null);
                                // A failed delete would otherwise just re-list
                                // the world as if nothing happened — say so.
                                setDeleteFailedId(deleted ? null : world.id);
                                if (deleted) refresh();
                              })
                            }
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
                        <button className="menu-card-play" data-testid={`cloud-sp-${world.id}`} onClick={() => onPlayCloud(world)}>
                          <span className="menu-card-name">{world.name}</span>
                          <span className="menu-card-sub">Singleplayer · synced ·{worldCardDetails(world)}</span>
                        </button>
                        <div className="menu-card-actions">
                          <button className="mc-button" onClick={() => setConfirmingDeleteId(world.id)}>
                            {deleteFailedId === world.id ? "Delete failed — retry" : "Delete"}
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      <div className="menu-bottom-row">
        <button className="mc-button" data-testid="back-to-profiles" onClick={onBack}>
          Back
        </button>
        <button className="mc-button" data-testid="new-sp-world" disabled={atCap} title={capTitle} onClick={() => setCreating("sp")}>
          {atCap ? `World limit reached (${MAX_WORLDS_PER_PROFILE})` : "New Singleplayer World"}
        </button>
        <button className="mc-button menu-primary" data-testid="new-online-world" disabled={atCap} title={capTitle} onClick={() => setCreating("mp")}>
          {atCap ? `World limit reached (${MAX_WORLDS_PER_PROFILE})` : "New Online World"}
        </button>
      </div>
    </MenuScreen>
  );
}
