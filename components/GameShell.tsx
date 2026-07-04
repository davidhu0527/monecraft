"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MinecraftGame from "@/components/MinecraftGame";
import AccountProfileSelect from "@/components/menu/AccountProfileSelect";
import OnlineWorldSelect from "@/components/menu/OnlineWorldSelect";
import ProfileSelect from "@/components/menu/ProfileSelect";
import WorldSelect from "@/components/menu/WorldSelect";
import { currentUser, ensureSignedIn, onlineUsed, type OnlineUser } from "@/lib/auth/client";
import { migrateLegacySave } from "@/lib/game/legacyMigration";
import { DEFAULT_SKIN_ID, isSkinId } from "@/lib/game/playerSkins";
import { getProfile, setActiveProfile, type Profile } from "@/lib/game/profiles";
import { createWorld, deleteWorld, getWorld, touchWorld, worldSaveKey, type WorldMeta } from "@/lib/game/worlds";
import { writeSave } from "@/lib/game/save";
import { pullCloudSaveIfNewer } from "@/lib/game/cloudSaves";
import { deleteOnlineWorld, requestJoinTicket, type OnlineWorld } from "@/lib/online/onlineClient";
import type { OnlineProfile } from "@/lib/online/profilesClient";
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
  | { name: "online-worlds"; profile: OnlineProfile }
  | { name: "play"; profileId: string; worldId: string }
  // play-online carries the resolved player identity (a local Profile for a
  // guest, or one derived from the account profile) plus that account profile
  // (null for the guest path) so "quit to worlds" returns to the right list.
  | { name: "play-online"; profile: Profile; world: OnlineWorld; session: NetworkSession; onlineProfile: OnlineProfile | null };

/** A play-usable Profile from a server-side account profile (skin sanitized). */
function profileFromOnline(profile: OnlineProfile): Profile {
  return { id: profile.id, name: profile.name, skinId: isSkinId(profile.skinId) ? profile.skinId : DEFAULT_SKIN_ID, createdAt: 0 };
}

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
  // The signed-in account (a real, non-anonymous one flips the menu into
  // account mode). Offline-first: never asked until this browser went online.
  const [onlineUser, setOnlineUser] = useState<OnlineUser | null>(null);
  const refreshOnlineUser = useCallback(() => {
    if (onlineUsed()) void currentUser().then(setOnlineUser);
  }, []);

  /**
   * Open a world for play. A cloud-linked one (WorldMeta.cloudId) reconciles
   * first: pull the remote save if it advanced past this device's cursor, write
   * it to disk, and boot from disk like any other world — reusing the "Opening…"
   * gate. The caller owns the `joiningRef` guard (this helper does not), so the
   * materialize-then-open path can hold it across `createWorld` too.
   */
  const openWorld = async (profileId: string, worldId: string) => {
    const world = getWorld(worldId);
    touchWorld(worldId);
    writeSessionPointer({ profileId, worldId });
    if (world?.cloudId) {
      setConnecting(world.name);
      try {
        const decision = await pullCloudSaveIfNewer(world.cloudId);
        if (decision.adopt) writeSave(worldSaveKey(worldId), decision.save);
      } catch {
        // Offline or a bad blob → fall through and play the local copy.
      } finally {
        setConnecting(null);
      }
    }
    setScreen({ name: "play", profileId, worldId });
  };

  const playLocal = async (profileId: string, worldId: string) => {
    if (joiningRef.current) return;
    joiningRef.current = true;
    try {
      await openWorld(profileId, worldId);
    } finally {
      joiningRef.current = false;
    }
  };

  /** Materialize a cloud save as a local world (linked by cloudId), then open it — the pull-on-open fills it in. */
  const downloadCloud = async (profileId: string, world: OnlineWorld) => {
    // Guard BEFORE createWorld so a fast double-click can't persist two local
    // worlds sharing the same cloudId (the second open would just be dropped).
    if (joiningRef.current) return;
    joiningRef.current = true;
    try {
      const local = createWorld(profileId, world.name, String(world.seed), {
        worldType: world.worldType as WorldMeta["worldType"],
        gameMode: world.gameMode as WorldMeta["gameMode"],
        difficulty: world.difficulty as WorldMeta["difficulty"],
        hardcore: world.hardcore,
        worldgenVersion: world.worldgenVersion,
        cloudId: world.id
      });
      await openWorld(profileId, local.id);
    } finally {
      joiningRef.current = false;
    }
  };

  /** Guest-or-account → ticket → socket → replica sync → play. When an account
   *  profile is given, its id rides the ticket so the roster shows that profile. */
  const playOnline = async (profile: Profile, world: OnlineWorld, onlineProfile: OnlineProfile | null) => {
    if (joiningRef.current) return; // a join is already in flight
    joiningRef.current = true;
    setConnectError(null);
    setConnecting(world.name);
    const ticketProfileId = onlineProfile?.id;
    try {
      if (!(await ensureSignedIn())) throw new Error("sign-in failed");
      const grant = await requestJoinTicket(world.id, ticketProfileId);
      if (!grant) throw new Error("could not get a join ticket (is the game server configured?)");
      // The reconnect ladder mints a fresh short-lived ticket each retry — the
      // 60 s TTL means a stale one is useless a minute after a drop.
      const session = await connectNetworkSession(grant.gameServerUrl, grant.ticket, undefined, {
        reconnect: async () => {
          const next = await requestJoinTicket(world.id, ticketProfileId);
          return next ? { url: next.gameServerUrl, ticket: next.ticket } : null;
        }
      });
      setScreen({ name: "play-online", profile, world, session, onlineProfile });
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

  // Discover an existing account session so a signed-in reload lands in account
  // mode (offline-first: refreshOnlineUser no-ops until this browser went online).
  useEffect(() => refreshOnlineUser(), [refreshOnlineUser]);

  // The "Opening…" gate and join-failure dialog, shared by both world lists.
  const netModals = (
    <>
      {connecting && (
        <div className="net-modal" role="status">
          <div className="net-modal-box">Opening “{connecting}”…</div>
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
    // Quit returns to the account profile's online worlds, or (guest path) the
    // local world list the join came from.
    const backToWorlds: Screen = screen.onlineProfile
      ? { name: "online-worlds", profile: screen.onlineProfile }
      : { name: "world-select", profileId: screen.profile.id };
    return (
      <MinecraftGame
        key={`online:${screen.world.id}`}
        world={onlineWorldMeta(screen.world, screen.profile.id)}
        profile={screen.profile}
        online={screen.session}
        onQuitToWorlds={() => setScreen(backToWorlds)}
        onDeleteWorld={() => {
          // Hardcore game-over: actually delete the shared world on the server
          // (owner-gated; a member just leaves), then return to the list.
          screen.session.dispose();
          void deleteOnlineWorld(screen.world.id);
          setScreen(backToWorlds);
        }}
        onReloadWorld={() => setScreen(backToWorlds)}
      />
    );
  }

  if (screen.name === "world-select") {
    const profile = getProfile(screen.profileId);
    if (profile) {
      return (
        <>
          <WorldSelect
            profile={profile}
            onPlay={(worldId) => void playLocal(profile.id, worldId)}
            onPlayOnline={(world) => void playOnline(profile, world, null)}
            onDownloadCloud={(world) => void downloadCloud(profile.id, world)}
            onBack={() => setScreen({ name: "profile-select" })}
          />
          {netModals}
        </>
      );
    }
  }

  if (screen.name === "online-worlds") {
    return (
      <>
        <OnlineWorldSelect
          profile={screen.profile}
          onPlay={(world) => void playOnline(profileFromOnline(screen.profile), world, screen.profile)}
          onBack={() => setScreen({ name: "profile-select" })}
        />
        {netModals}
      </>
    );
  }

  // The profile-select screen is auth-aware: a signed-in account browses its
  // synced online profiles; everyone else gets the local (browser) profiles.
  if (onlineUser && !onlineUser.isAnonymous) {
    return (
      <AccountProfileSelect user={onlineUser} onPlay={(profile) => setScreen({ name: "online-worlds", profile })} onSignedOut={() => setOnlineUser(null)} />
    );
  }

  return (
    <ProfileSelect
      onPlay={(profileId) => {
        setActiveProfile(profileId);
        setScreen({ name: "world-select", profileId });
      }}
      onAuthChange={refreshOnlineUser}
    />
  );
}
