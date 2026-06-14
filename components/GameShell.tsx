"use client";

import { useEffect, useState } from "react";
import MinecraftGame from "@/components/MinecraftGame";
import ProfileSelect from "@/components/menu/ProfileSelect";
import WorldSelect from "@/components/menu/WorldSelect";
import { migrateLegacySave } from "@/lib/game/legacyMigration";
import { getProfile, setActiveProfile } from "@/lib/game/profiles";
import { getWorld, touchWorld } from "@/lib/game/worlds";
import { installUiTiles } from "@/lib/ui/chromeTiles";

/**
 * Top-level menu shell. Owns the screen state machine (profile-select ->
 * world-select -> play) and boots the legacy migration once on mount. The play
 * screen mounts MinecraftGame keyed by world id + a reload nonce, so switching
 * worlds (or Load/Reset) remounts the subtree — the game effect's cleanup
 * disposes the old engine/renderer and a fresh mount boots the next world, with
 * no page reload.
 */
type Screen = { name: "profile-select" } | { name: "world-select"; profileId: string } | { name: "play"; profileId: string; worldId: string };

/**
 * Remembers the world being played for this tab so a reload resumes it instead
 * of dropping back to the menu. sessionStorage (not localStorage) so a brand-new
 * tab still cold-starts at profile-select.
 */
const SESSION_KEY = "monecraft_active_session";

function readSessionPointer(): { profileId: string; worldId: string } | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { profileId?: unknown; worldId?: unknown };
    if (typeof parsed?.profileId === "string" && typeof parsed?.worldId === "string") {
      return { profileId: parsed.profileId, worldId: parsed.worldId };
    }
    return null;
  } catch {
    return null;
  }
}

function writeSessionPointer(pointer: { profileId: string; worldId: string } | null): void {
  try {
    if (pointer) sessionStorage.setItem(SESSION_KEY, JSON.stringify(pointer));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // No resume across reload if sessionStorage is unavailable — never fatal.
  }
}

export default function GameShell() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>({ name: "profile-select" });
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    installUiTiles(); // the menu chrome shares the in-game noise tiles
    migrateLegacySave();
    // Resume the tab's world if one was being played and still exists.
    const pointer = readSessionPointer();
    const resume: Screen | null =
      pointer && getProfile(pointer.profileId) && getWorld(pointer.worldId) ? { name: "play", profileId: pointer.profileId, worldId: pointer.worldId } : null;
    // Microtask hop keeps this off the synchronous effect path (cascading-render lint).
    queueMicrotask(() => {
      if (resume) setScreen(resume);
      setReady(true);
    });
  }, []);

  // localStorage is read below; hold the neutral frame until we're client-side.
  if (!ready) return <div className="menu-screen" />;

  if (screen.name === "play") {
    const profile = getProfile(screen.profileId);
    const world = getWorld(screen.worldId);
    // Both exist in normal flow; a cross-tab delete drops us back to a menu.
    if (profile && world) {
      return (
        <MinecraftGame
          key={`${world.id}:${reloadNonce}`}
          world={world}
          profile={profile}
          onQuitToWorlds={() => {
            writeSessionPointer(null);
            setScreen({ name: "world-select", profileId: profile.id });
          }}
          onReloadWorld={() => setReloadNonce((nonce) => nonce + 1)}
        />
      );
    }
  }

  if (screen.name === "world-select") {
    const profile = getProfile(screen.profileId);
    if (profile) {
      return (
        <WorldSelect
          profile={profile}
          onPlay={(worldId) => {
            touchWorld(worldId);
            writeSessionPointer({ profileId: profile.id, worldId });
            setScreen({ name: "play", profileId: profile.id, worldId });
          }}
          onBack={() => setScreen({ name: "profile-select" })}
        />
      );
    }
  }

  return (
    <ProfileSelect
      onPlay={(profileId) => {
        setActiveProfile(profileId);
        setScreen({ name: "world-select", profileId });
      }}
    />
  );
}
