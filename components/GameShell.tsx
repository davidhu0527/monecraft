"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MinecraftGame from "@/components/MinecraftGame";
import AccountProfileSelect from "@/components/menu/AccountProfileSelect";
import AuthScreen from "@/components/menu/AuthScreen";
import OnlineWorldSelect from "@/components/menu/OnlineWorldSelect";
import ProfileSelect from "@/components/menu/ProfileSelect";
import WelcomeScreen from "@/components/menu/WelcomeScreen";
import WorldSelect from "@/components/menu/WorldSelect";
import { currentUser, onlineUsed, type OnlineUser } from "@/lib/auth/client";
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
 * Top-level menu shell. Owns the screen state machine — logged out it roots at
 * the welcome gate (sign in via the dedicated auth screen, or play locally:
 * welcome -> auth | profile-select -> world-select -> play), while a signed-in
 * session skips the gate straight to the account home — and boots the legacy
 * migration once on mount. The play screen mounts MinecraftGame keyed by world
 * id + a reload nonce, so switching worlds (or Load/Reset) remounts the
 * subtree — the game effect's cleanup disposes the old engine/renderer and a
 * fresh mount boots the next world, with no page reload.
 */
type Screen =
  // The logged-out root: choose an online account or local (browser) play.
  | { name: "welcome" }
  // The dedicated sign-in / register screen behind the gate's "Sign in".
  | { name: "auth" }
  | { name: "profile-select" }
  | { name: "world-select"; profileId: string }
  | { name: "online-worlds"; profile: OnlineProfile }
  | { name: "play"; profileId: string; worldId: string }
  // An account profile's singleplayer (sp-cloud) world: full local engine, no
  // game server — the save syncs to the account as a cloud blob.
  | { name: "play-cloud"; profile: OnlineProfile; world: OnlineWorld }
  // play-online carries the play-usable identity derived from the account
  // profile, plus that profile itself so "quit to worlds" returns to its list.
  | { name: "play-online"; profile: Profile; world: OnlineWorld; session: NetworkSession; onlineProfile: OnlineProfile };

/** A play-usable Profile from a server-side account profile (skin sanitized). */
function profileFromOnline(profile: OnlineProfile): Profile {
  return { id: profile.id, name: profile.name, skinId: isSkinId(profile.skinId) ? profile.skinId : DEFAULT_SKIN_ID, createdAt: 0 };
}

/**
 * An account singleplayer world's meta: the `cloud:` id keys this device's
 * localStorage save cache, and `cloudId` makes the game hook's autosave sync
 * push every save up to the account blob.
 */
function cloudWorldMeta(world: OnlineWorld, profileId: string): WorldMeta {
  return { ...onlineWorldMeta(world, profileId), id: `cloud:${world.id}`, cloudId: world.id };
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

/** How long the welcome gate may wait on the session probe before showing. */
const AUTH_PROBE_TIMEOUT_MS = 4000;

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
  const [screen, setScreen] = useState<Screen>({ name: "welcome" });
  const [reloadNonce, setReloadNonce] = useState(0);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  // A join is in flight — guards against a double-click opening (and leaking) a
  // second socket. A ref, not `connecting`, so it's set synchronously.
  const joiningRef = useRef(false);
  // The signed-in account (its presence flips the menu into account mode).
  // Offline-first: never asked until this browser went online.
  const [onlineUser, setOnlineUser] = useState<OnlineUser | null>(null);
  // The local-worlds door: a signed-in account browsing its local (browser)
  // profiles/worlds — where cloud-save sync lives — without signing out.
  const [browsingLocal, setBrowsingLocal] = useState(false);
  // True once the mount-time session probe has answered (or was skipped) —
  // the welcome gate holds a neutral frame until then, so a signed-in reload
  // lands straight on the account home with no gate flash.
  const [authProbed, setAuthProbed] = useState(false);
  const refreshOnlineUser = useCallback(() => {
    if (!onlineUsed()) {
      // Pure-local browser: nothing to probe. Microtask hop keeps the set off
      // the synchronous effect path (cascading-render lint).
      queueMicrotask(() => setAuthProbed(true));
      return;
    }
    // A hung probe (stalled fetch, dead proxy) must not strand the gate on the
    // neutral frame: reveal it at the deadline and treat the visitor as logged
    // out — a probe that settles later still flips into account mode.
    const deadline = setTimeout(() => setAuthProbed(true), AUTH_PROBE_TIMEOUT_MS);
    void currentUser().then(
      (user) => {
        clearTimeout(deadline);
        setOnlineUser(user);
        if (!user) setBrowsingLocal(false); // signed out: the door has no "back"
        setAuthProbed(true);
      },
      () => {
        clearTimeout(deadline);
        setAuthProbed(true); // probe failed (offline): treat as logged out
      }
    );
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

  /**
   * Open an account singleplayer world: reconcile this device's save cache
   * with the cloud blob (adopt the remote only when it advanced past our
   * cursor), then boot the full local engine — no game server involved.
   * Unlike local worlds there is no manifest entry and no session-resume
   * pointer; a reload lands back on the menu (like play-online).
   */
  const playCloud = async (profile: OnlineProfile, world: OnlineWorld) => {
    if (joiningRef.current) return;
    joiningRef.current = true;
    setConnecting(world.name);
    try {
      const decision = await pullCloudSaveIfNewer(world.id);
      if (decision.adopt) writeSave(worldSaveKey(`cloud:${world.id}`), decision.save);
    } catch {
      // Offline or a bad blob → play this device's cache (or a fresh world).
    } finally {
      setConnecting(null);
      joiningRef.current = false;
    }
    setScreen({ name: "play-cloud", profile, world });
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

  /** Account profile → ticket → socket → replica sync → play. The profile's id
   *  rides the ticket so the roster shows that profile's name and skin. */
  const playOnline = async (profile: Profile, world: OnlineWorld, onlineProfile: OnlineProfile) => {
    if (joiningRef.current) return; // a join is already in flight
    joiningRef.current = true;
    setConnectError(null);
    setConnecting(world.name);
    const ticketProfileId = onlineProfile.id;
    try {
      // No sign-in pre-check: this is only reachable from account mode, and an
      // expired session just fails the ticket mint into the dialog below.
      const grant = await requestJoinTicket(world.id, ticketProfileId);
      if (!grant) throw new Error("could not get a join ticket — are you still signed in, and is the game server configured?");
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
      if (resume) {
        setScreen(resume);
        // A resumed local world means the player came through the local menus —
        // quitting should walk back out through them, even for a signed-in
        // account, not jump abruptly to the account home.
        setBrowsingLocal(true);
      }
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

  if (screen.name === "play-cloud") {
    const backToWorlds: Screen = { name: "online-worlds", profile: screen.profile };
    return (
      <MinecraftGame
        key={`cloud:${screen.world.id}:${reloadNonce}`}
        world={cloudWorldMeta(screen.world, screen.profile.id)}
        profile={profileFromOnline(screen.profile)}
        onQuitToWorlds={() => setScreen(backToWorlds)}
        onDeleteWorld={() => {
          // Hardcore game-over: delete the cloud world (row + blob), then this
          // device's save cache — only after the server confirmed, so a failed
          // delete (offline) leaves a still-playable world in the list rather
          // than a hollow one that re-downloads its own game-over.
          void deleteOnlineWorld(screen.world.id).then((deleted) => {
            if (!deleted) return;
            try {
              localStorage.removeItem(worldSaveKey(`cloud:${screen.world.id}`));
            } catch {
              // Cache cleanup only — never fatal.
            }
          });
          setScreen(backToWorlds);
        }}
        onReloadWorld={() => setReloadNonce((nonce) => nonce + 1)}
      />
    );
  }

  if (screen.name === "play-online") {
    // Quit returns to the account profile's online worlds.
    const backToWorlds: Screen = { name: "online-worlds", profile: screen.onlineProfile };
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
            onDownloadCloud={(world) => void downloadCloud(profile.id, world)}
            cloudEnabled={onlineUser !== null}
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
          onPlayOnline={(world) => void playOnline(profileFromOnline(screen.profile), world, screen.profile)}
          onPlayCloud={(world) => void playCloud(screen.profile, world)}
          onBack={() => setScreen({ name: "profile-select" })}
        />
        {netModals}
      </>
    );
  }

  // The root menus are auth-aware: a signed-in account gets its account home
  // (unless it stepped through the local-worlds door), a logged-out visitor
  // roots at the welcome gate — sign in on the dedicated screen, or browse the
  // local (browser) profiles.
  const accountMode = onlineUser !== null;
  if (accountMode && !browsingLocal) {
    return (
      <AccountProfileSelect
        user={onlineUser}
        onPlay={(profile) => setScreen({ name: "online-worlds", profile })}
        onPlayLocally={() => {
          // Set the screen too: it may still read "welcome"/"auth", which
          // would bounce the door back to the gate instead of the local list.
          setBrowsingLocal(true);
          setScreen({ name: "profile-select" });
        }}
        onSignedOut={() => {
          setOnlineUser(null);
          setScreen({ name: "welcome" }); // sign-out lands on the gate
        }}
      />
    );
  }

  if (screen.name === "auth") {
    return <AuthScreen onAuthChange={refreshOnlineUser} onBack={() => setScreen({ name: "welcome" })} />;
  }

  if (screen.name === "welcome") {
    // Hold the neutral frame until the session probe answers — a signed-in
    // reload goes straight to the account home above, never a gate flash.
    if (!authProbed) return <div className="menu-screen" />;
    return <WelcomeScreen onSignIn={() => setScreen({ name: "auth" })} onPlayLocally={() => setScreen({ name: "profile-select" })} />;
  }

  return (
    <ProfileSelect
      onPlay={(profileId) => {
        setActiveProfile(profileId);
        setScreen({ name: "world-select", profileId });
      }}
      onBackToAccount={accountMode ? () => setBrowsingLocal(false) : undefined}
      onBackToWelcome={accountMode ? undefined : () => setScreen({ name: "welcome" })}
    />
  );
}
