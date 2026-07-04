"use client";

import { useCallback, useEffect, useState } from "react";
import CreateWorldForm from "@/components/menu/CreateWorldForm";
import MenuScreen from "@/components/menu/MenuScreen";
import { GAME_MODE_PRESETS, type GameMode } from "@/lib/game/gameModes";
import { DIFFICULTY_PRESETS, type Difficulty } from "@/lib/game/difficulties";
import { MAX_WORLDS_PER_PROFILE } from "@/lib/game/config";
import { resolveSeed, WORLD_TYPE_PRESETS } from "@/lib/game/worlds";
import type { WorldType } from "@/lib/world";
import { createOnlineWorld, listOnlineWorlds, createInviteLink, revokeInviteLinks, type OnlineWorld } from "@/lib/online/onlineClient";
import type { OnlineProfile } from "@/lib/online/profilesClient";

/**
 * An account profile's online worlds: the account-mode counterpart to
 * WorldSelect. Lists only this profile's server-hosted (mp) worlds, creates new
 * ones (capped at MAX_WORLDS_PER_PROFILE), and copies/revokes invite links. All
 * worlds here live on the server and belong to `profile` via `world.profileId`.
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

type OnlineWorldSelectProps = {
  profile: OnlineProfile;
  /** Join a server-hosted world as this profile. */
  onPlay: (world: OnlineWorld) => void;
  /** Back to the account's profile list. */
  onBack: () => void;
};

export default function OnlineWorldSelect({ profile, onPlay, onBack }: OnlineWorldSelectProps) {
  const [creating, setCreating] = useState(false);
  const [worlds, setWorlds] = useState<OnlineWorld[] | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invitesRevoked, setInvitesRevoked] = useState<string | null>(null);

  // Only this profile's server rooms (the account may own others under a
  // different profile); listOnlineWorlds returns everything the account plays.
  const refresh = useCallback(() => {
    void listOnlineWorlds().then((all) => setWorlds((all ?? []).filter((world) => world.kind === "mp" && world.profileId === profile.id)));
  }, [profile.id]);
  useEffect(() => refresh(), [refresh]);

  const atCap = (worlds?.length ?? 0) >= MAX_WORLDS_PER_PROFILE;

  if (creating) {
    return (
      <MenuScreen title={`${profile.name} — New Online World`}>
        {createError && <p className="account-error">{createError}</p>}
        <CreateWorldForm
          onCreate={(name, seed, worldType, gameMode, difficulty, hardcore) => {
            setCreateError(null);
            void createOnlineWorld({ name, seed: resolveSeed(seed), worldType, gameMode, difficulty, hardcore, profileId: profile.id }).then((world) => {
              if (world) {
                setCreating(false);
                onPlay(world);
              } else {
                setCreateError("Couldn't create the world — are you online, and under your world limit?");
              }
            });
          }}
          onCancel={() => setCreating(false)}
        />
      </MenuScreen>
    );
  }

  return (
    <MenuScreen title={`${profile.name} — Online Worlds`}>
      {worlds === null ? (
        <p className="menu-empty">Loading…</p>
      ) : worlds.length === 0 ? (
        <p className="menu-empty">No online worlds yet — create one and share the invite link.</p>
      ) : (
        <ul className="menu-list">
          {worlds.map((world) => (
            <li key={world.id} className="menu-card">
              <button className="menu-card-play" data-testid={`online-world-${world.id}`} onClick={() => onPlay(world)}>
                <span className="menu-card-name">{world.name}</span>
                <span className="menu-card-sub">
                  {world.role === "owner" ? "Your world" : "Joined"} ·{world.hardcore ? " Hardcore ·" : ""}
                  {world.gameMode !== "survival" ? ` ${gameModeLabel(world.gameMode as GameMode)} ·` : ""}
                  {!world.hardcore && world.difficulty !== "normal" ? ` ${difficultyLabel(world.difficulty as Difficulty)} ·` : ""}
                  {world.worldType !== "default" ? ` ${worldTypeLabel(world.worldType as WorldType)} ·` : ""} Seed {world.seed}
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
      <div className="menu-bottom-row">
        <button className="mc-button" data-testid="back-to-profiles" onClick={onBack}>
          Back
        </button>
        <button
          className="mc-button menu-primary"
          data-testid="new-online-world"
          disabled={atCap}
          title={atCap ? `Profile world limit reached (${MAX_WORLDS_PER_PROFILE})` : undefined}
          onClick={() => setCreating(true)}
        >
          {atCap ? `World limit reached (${MAX_WORLDS_PER_PROFILE})` : "New Online World"}
        </button>
      </div>
    </MenuScreen>
  );
}
