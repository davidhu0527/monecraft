import { useState } from "react";
import PixelImg from "@/components/game/PixelImg";
import CreateProfileForm from "@/components/menu/CreateProfileForm";
import MenuScreen from "@/components/menu/MenuScreen";
import { createProfile, deleteProfile, MAX_PROFILE_NAME, readProfiles, renameProfile } from "@/lib/game/profiles";
import { skinPortraitUrl } from "@/lib/ui/sprites";
import { deleteWorldsForProfile, worldsForProfile } from "@/lib/game/worlds";

type ProfileSelectProps = {
  /** Enter a profile: select it and show its worlds. */
  onPlay: (profileId: string) => void;
};

/** The top menu: pick a player profile, or create / rename / delete one. */
export default function ProfileSelect({ onPlay }: ProfileSelectProps) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const { profiles } = readProfiles();
  // With no profiles (first run, or the last one was just deleted) there is
  // nothing to select, so open straight into the create form with no Cancel.
  const firstRun = profiles.length === 0;

  if (creating || firstRun) {
    return (
      <MenuScreen title={firstRun ? "Create Your Profile" : "New Profile"}>
        <CreateProfileForm
          onCreate={(name, skinId) => {
            const profile = createProfile(name, skinId);
            setCreating(false);
            onPlay(profile.id); // straight into the new profile's (empty) world list
          }}
          onCancel={firstRun ? undefined : () => setCreating(false)}
        />
      </MenuScreen>
    );
  }

  return (
    <MenuScreen title="Select Profile">
      <ul className="menu-list">
        {profiles.map((profile) => (
          <li key={profile.id} className="menu-card">
            {editingId === profile.id ? (
              <form
                className="menu-rename"
                onSubmit={(event) => {
                  event.preventDefault();
                  renameProfile(profile.id, editName);
                  setEditingId(null); // re-render re-reads the manifest
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
                <span>Delete “{profile.name}” and all its worlds?</span>
                <div className="menu-confirm-actions">
                  <button
                    className="mc-button danger"
                    onClick={() => {
                      deleteWorldsForProfile(profile.id);
                      deleteProfile(profile.id);
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
                <button className="menu-card-play" data-testid={`profile-${profile.id}`} onClick={() => onPlay(profile.id)}>
                  <PixelImg src={skinPortraitUrl(profile.skinId)} alt="" size={40} aria-hidden />
                  <span className="menu-card-name">{profile.name}</span>
                  <span className="menu-card-sub">{worldsForProfile(profile.id).length} worlds</span>
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
      <button className="mc-button menu-primary" data-testid="new-profile" onClick={() => setCreating(true)}>
        New Profile
      </button>
    </MenuScreen>
  );
}
