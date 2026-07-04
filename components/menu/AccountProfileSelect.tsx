"use client";

import { useEffect, useState } from "react";
import PixelImg from "@/components/game/PixelImg";
import CreateProfileForm from "@/components/menu/CreateProfileForm";
import MenuScreen from "@/components/menu/MenuScreen";
import { MAX_ONLINE_PROFILES } from "@/lib/game/config";
import { DEFAULT_SKIN_ID, isSkinId } from "@/lib/game/playerSkins";
import { MAX_PROFILE_NAME } from "@/lib/game/profiles";
import { authClient, type OnlineUser } from "@/lib/auth/client";
import { createOnlineProfile, deleteOnlineProfile, listOnlineProfiles, updateOnlineProfile, type OnlineProfile } from "@/lib/online/profilesClient";
import { skinPortraitUrl } from "@/lib/ui/sprites";

/**
 * The signed-in account's home: its server-side profiles (name + skin), synced
 * across devices. The account-mode counterpart to ProfileSelect — picking a
 * profile shows that profile's online worlds. Local Players (logged out) never
 * see this; guests can't have profiles. Capped at MAX_ONLINE_PROFILES.
 */

type AccountProfileSelectProps = {
  user: OnlineUser;
  /** Enter an online profile: show its server-hosted worlds. */
  onPlay: (profile: OnlineProfile) => void;
  /** After signing out — the caller drops back to the local (logged-out) menu. */
  onSignedOut: () => void;
};

export default function AccountProfileSelect({ user, onPlay, onSignedOut }: AccountProfileSelectProps) {
  const [profiles, setProfiles] = useState<OnlineProfile[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => void listOnlineProfiles().then(setProfiles);
  useEffect(() => refresh(), []);

  const signOut = async () => {
    setBusy(true);
    setError(null);
    try {
      await authClient().signOut();
      onSignedOut();
    } catch {
      setError("Couldn't sign out — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const atCap = (profiles?.length ?? 0) >= MAX_ONLINE_PROFILES;

  if (creating) {
    return (
      <MenuScreen title="New Profile">
        {error && <p className="account-error">{error}</p>}
        <CreateProfileForm
          onCreate={(name, skinId) => {
            setError(null);
            void createOnlineProfile({ name, skinId }).then((profile) => {
              if (profile) {
                setCreating(false);
                onPlay(profile);
              } else {
                // Keep the form open so the entered name/skin aren't lost on retry.
                setError("Couldn't create the profile — are you online, and under your profile limit?");
                refresh();
              }
            });
          }}
          onCancel={() => {
            setError(null);
            setCreating(false);
          }}
        />
      </MenuScreen>
    );
  }

  return (
    <MenuScreen title="Your Profiles">
      <div className="account-panel">
        <span className="account-status">Signed in as {user.name}</span>
        <button type="button" className="mc-button" onClick={signOut} disabled={busy}>
          Sign out
        </button>
        {error && <div className="account-error">{error}</div>}
      </div>
      {profiles === null ? (
        <p className="menu-empty">Loading…</p>
      ) : profiles.length === 0 ? (
        <p className="menu-empty">No profiles yet — create one to play online.</p>
      ) : (
        <ul className="menu-list">
          {profiles.map((profile) => (
            <li key={profile.id} className="menu-card">
              {editingId === profile.id ? (
                <form
                  className="menu-rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void updateOnlineProfile(profile.id, { name: editName }).then(() => {
                      setEditingId(null);
                      refresh();
                    });
                  }}
                >
                  <input
                    className="menu-input"
                    value={editName}
                    maxLength={MAX_PROFILE_NAME}
                    autoFocus
                    aria-label="Rename profile"
                    onChange={(event) => setEditName(event.target.value)}
                  />
                  <button type="submit" className="mc-button">
                    Save
                  </button>
                  <button type="button" className="mc-button" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </form>
              ) : confirmingDeleteId === profile.id ? (
                <div className="menu-confirm">
                  <span>Delete “{profile.name}” and all its online worlds?</span>
                  <div className="menu-confirm-actions">
                    <button
                      className="mc-button danger"
                      onClick={() =>
                        void deleteOnlineProfile(profile.id).then(() => {
                          setConfirmingDeleteId(null);
                          refresh();
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
                  <button className="menu-card-play" data-testid={`online-profile-${profile.id}`} onClick={() => onPlay(profile)}>
                    <PixelImg src={skinPortraitUrl(isSkinId(profile.skinId) ? profile.skinId : DEFAULT_SKIN_ID)} alt="" size={40} aria-hidden />
                    <span className="menu-card-name">{profile.name}</span>
                  </button>
                  <div className="menu-card-actions">
                    <button
                      className="mc-button"
                      onClick={() => {
                        setEditName(profile.name);
                        setEditingId(profile.id);
                      }}
                    >
                      Rename
                    </button>
                    <button className="mc-button" onClick={() => setConfirmingDeleteId(profile.id)}>
                      Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <button
        className="mc-button menu-primary"
        data-testid="new-online-profile"
        disabled={atCap}
        title={atCap ? `Profile limit reached (${MAX_ONLINE_PROFILES})` : undefined}
        onClick={() => setCreating(true)}
      >
        {atCap ? `Profile limit reached (${MAX_ONLINE_PROFILES})` : "New Profile"}
      </button>
    </MenuScreen>
  );
}
