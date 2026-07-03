"use client";

import { useEffect, useRef, useState } from "react";
import MinecraftGame from "@/components/MinecraftGame";
import ProfileSelect from "@/components/menu/ProfileSelect";
import WorldSelect from "@/components/menu/WorldSelect";
import { ensureSignedIn } from "@/lib/auth/client";
import { migrateLegacySave } from "@/lib/game/legacyMigration";
import { getProfile, setActiveProfile } from "@/lib/game/profiles";
import { deleteWorld, getWorld, touchWorld, type WorldMeta } from "@/lib/game/worlds";
import { deleteOnlineWorld, requestJoinTicket, type OnlineWorld } from "@/lib/online/onlineClient";
import { connectNetworkSession, type NetworkSession } from "@/lib/net/NetworkSession";
import { installUiTiles } from "@/lib/ui/chromeTiles";

/**
 * Top-level menu shell. Owns the screen state machine (profile-select ->
 * world-select -> play) and boots the legacy migration once on mount. The play
 * screen mounts MinecraftGame keyed by world id + a reload nonce, so switching
 * worlds (or Load/Reset) remounts the subtree — the game effect's cleanup
 * disposes the old engine/renderer and a fresh mount boots the next world, with
 * no page reload.
 */
type Screen =
  | { name: "profile-select" }
  | { name: "world-select"; profileId: string }
  | { name: "play"; profileId: string; worldId: string }
  | { name: "play-online"; profileId: string; world: OnlineWorld; session: NetworkSession };

/** Online worlds mount the same game subtree; the meta is a projection of the server row. */
function onlineWorldMeta(world: OnlineWorld, profileId: string): WorldMeta {
  return {
    id: `online:${world.id}`,
    profileId,
    name: world.name,
    seed: world.seed,
    worldType: world.worldType as WorldMeta["worldType"],
    gameMode: world.gameMode as WorldMeta["gameMode"],
    difficulty: world.difficulty as WorldMeta["difficulty"],
    hardcore: world.hardcore,
    worldgenVersion: world.worldgenVersion,
    createdAt: 0,
    lastPlayedAt: 0
  };
}

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
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  // A join is in flight — guards against a double-click opening (and leaking) a
  // second socket. A ref, not `connecting`, so it's set synchronously.
  const joiningRef = useRef(false);

  /** Guest-or-account → ticket → socket → replica sync → play. */
  const playOnline = async (profileId: string, world: OnlineWorld) => {
    if (joiningRef.current) return; // a join is already in flight
    joiningRef.current = true;
    setConnectError(null);
    setConnecting(world.name);
    try {
      if (!(await ensureSignedIn())) throw new Error("sign-in failed");
      const grant = await requestJoinTicket(world.id);
      if (!grant) throw new Error("could not get a join ticket (is the game server configured?)");
      // The reconnect ladder mints a fresh short-lived ticket each retry — the
      // 60 s TTL means a stale one is useless a minute after a drop.
      const session = await connectNetworkSession(grant.gameServerUrl, grant.ticket, undefined, {
        reconnect: async () => {
          const next = await requestJoinTicket(world.id);
          return next ? { url: next.gameServerUrl, ticket: next.ticket } : null;
        }
      });
      setScreen({ name: "play-online", profileId, world, session });
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "connection failed");
    } finally {
      setConnecting(null);
      joiningRef.current = false;
    }
  };

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
          onDeleteWorld={() => {
            deleteWorld(world.id); // hardcore Game Over: erase the dead world and leave
            writeSessionPointer(null);
            setScreen({ name: "world-select", profileId: profile.id });
          }}
          onReloadWorld={() => setReloadNonce((nonce) => nonce + 1)}
        />
      );
    }
  }

  if (screen.name === "play-online") {
    const profile = getProfile(screen.profileId);
    if (profile) {
      return (
        <MinecraftGame
          key={`online:${screen.world.id}`}
          world={onlineWorldMeta(screen.world, profile.id)}
          profile={profile}
          online={screen.session}
          onQuitToWorlds={() => setScreen({ name: "world-select", profileId: profile.id })}
          onDeleteWorld={() => {
            // Hardcore game-over: actually delete the shared world on the server
            // (owner-gated; a member just leaves), then return to the list.
            screen.session.dispose();
            void deleteOnlineWorld(screen.world.id);
            setScreen({ name: "world-select", profileId: profile.id });
          }}
          onReloadWorld={() => setScreen({ name: "world-select", profileId: profile.id })}
        />
      );
    }
  }

  if (screen.name === "world-select") {
    const profile = getProfile(screen.profileId);
    if (profile) {
      return (
        <>
          <WorldSelect
            profile={profile}
            onPlay={(worldId) => {
              touchWorld(worldId);
              writeSessionPointer({ profileId: profile.id, worldId });
              setScreen({ name: "play", profileId: profile.id, worldId });
            }}
            onPlayOnline={(world) => void playOnline(profile.id, world)}
            onBack={() => setScreen({ name: "profile-select" })}
          />
          {connecting && (
            <div className="net-modal" role="status">
              <div className="net-modal-box">Joining “{connecting}”…</div>
            </div>
          )}
          {connectError && (
            <div className="net-modal" role="alertdialog" aria-label="Connection failed">
              <div className="net-modal-box">
                <p>Couldn&apos;t join: {connectError}</p>
                <button type="button" className="mc-button" onClick={() => setConnectError(null)}>
                  OK
                </button>
              </div>
            </div>
          )}
        </>
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
