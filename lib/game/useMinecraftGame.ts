"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createAudioDirector, DEFAULT_AUDIO_SETTINGS, type AudioDirector, type AudioSettings } from "@/lib/game/audio/audioDirector";
import { readAudioSettings, writeAudioSettings } from "@/lib/game/audio/settings";
import { AUTOSAVE_INTERVAL_MS, HOTBAR_SLOTS, MAX_HUNGER, MAX_HEARTS, MAX_OXYGEN } from "@/lib/game/config";
import { GameEngine } from "@/lib/game/engine/GameEngine";
import type { GameApi, GameSnapshot } from "@/lib/game/engine/state";
import { createAccumulator } from "@/lib/game/engine/tickDriver";
import { createInputController, type InputController } from "@/lib/game/input/inputController";
import { createTouchInputController, type TouchControlsApi } from "@/lib/game/input/touchInputController";
import { DEFAULT_TOUCH_SETTINGS, readTouchSettings, resolveTouchEnabled, writeTouchSettings, type TouchSettings } from "@/lib/game/input/touchSettings";
import * as inv from "@/lib/game/inventory";
import { getSkinPreset, type SkinId } from "@/lib/game/playerSkins";
import { type Profile, setProfileSkin } from "@/lib/game/profiles";
import { createEmptyArmorEquipment, createInitialInventory, ITEM_DEF_BY_ID } from "@/lib/game/items";
import { RECIPES } from "@/lib/game/recipes";
import { GameRenderer } from "@/lib/game/render/GameRenderer";
import { createMinimapRenderer, type MinimapRenderer } from "@/lib/game/render/minimap";
import { worldSaves } from "@/lib/game/saveStore";
import { pushSave } from "@/lib/game/cloudSaves";
import type { ArmorSlot, EnchantmentId, Recipe, SaveData } from "@/lib/game/types";
import type { GameMode } from "@/lib/game/gameModes";
import type { Difficulty } from "@/lib/game/difficulties";
import type { WorldMeta } from "@/lib/game/worlds";
import type { NetworkSession } from "@/lib/net/NetworkSession";

/**
 * Thin React shell around the headless GameEngine and the GameRenderer.
 *
 * The engine is created in the canvas mount's callback ref (commit phase) and
 * held in React state; the UI reads it through useSyncExternalStore snapshots
 * and sends intents back as engine commands. The effect below owns everything
 * with a lifecycle: renderer, input listeners, the rAF loop, and autosave.
 */

// Pre-mount snapshot (also the SSR snapshot): the starter loadout at full stats.
const PRE_MOUNT_SNAPSHOT: GameSnapshot = {
  api: null,
  inventory: createInitialInventory(),
  equippedArmor: createEmptyArmorEquipment(),
  selectedSlot: 0,
  gameMode: "survival",
  difficulty: "normal",
  hardcore: false,
  gameOver: false,
  isFlying: false,
  hearts: MAX_HEARTS,
  hunger: MAX_HUNGER,
  oxygen: MAX_OXYGEN,
  daylightPercent: 100,
  passiveCount: 0,
  hostileCount: 0,
  respawnSeconds: 0,
  inventoryOpen: false,
  advancementsOpen: false,
  advancementsUnlocked: 0,
  paused: false,
  debugOpen: false,
  debug: null,
  cameraMode: "first",
  armorPoints: 0,
  capsActive: false,
  sleeping: false,
  craftingStation: null,
  activeVillagerProfession: null,
  container: null,
  boss: null,
  treasure: null,
  victory: false,
  activeEffects: [],
  xpLevel: 0,
  xpProgress: 0
};

const noopSubscribe = () => () => {};

type GameContext = { engine: GameEngine; node: HTMLDivElement };

// Debug/test handle: lets the browser console and the Playwright E2E suite
// inspect the live simulation (single-player client game — nothing to protect).
declare global {
  interface Window {
    __monecraft?: { engine: GameEngine; renderer: GameRenderer; input: InputController; audio: AudioDirector; net?: NetworkSession };
  }
}

function persistGame(api: GameApi, worldId: string, onMessage: (text: string) => void): void {
  let data: SaveData;
  try {
    data = api.serialize();
  } catch {
    onMessage("Save failed");
    return;
  }
  // Queued latest-wins write; the toast fires when the data (or newer) is
  // durably committed, and a remount read is ordered after it by the store.
  void worldSaves.write(worldId, data).then(
    () => onMessage("Saved"),
    () => onMessage("Save failed")
  );
}

/**
 * One mounted game = one world played by one profile. The owning shell remounts
 * this hook (via a React `key` on the world id) to switch worlds, so the
 * per-world save key and the profile are fixed for the hook's lifetime.
 */
export type UseMinecraftGameOptions = {
  world: WorldMeta;
  profile: Profile;
  /**
   * The world's SaveData preloaded by the shell (WorldSaveGate) so the engine
   * boot in the mount callback stays synchronous. Null = fresh world from seed.
   */
  initialSave: SaveData | null;
  /**
   * A connected multiplayer session: its replica engine is mounted instead of
   * constructing one, dispatch routes through it (GameEngine.routeDispatch),
   * local persistence is skipped (the server owns the world), and its
   * pose stream flushes each frame. Absent = classic offline single-player.
   */
  online?: NetworkSession;
  /** Leave this world and return to the world list (the shell unmounts us). */
  onQuitToWorlds: () => void;
  /** Re-read this world from disk by forcing a fresh mount (used by Load/Reset). */
  onReloadWorld: () => void;
};

export function useMinecraftGame(opts: UseMinecraftGameOptions) {
  // The owning shell keys this hook by world id, so the world is fixed for the
  // mount's life; capturing it once in refs lets the long-lived rAF/autosave
  // effect read the world id and seed without re-subscribing.
  const worldIdRef = useRef(opts.world.id);
  const initialSaveRef = useRef(opts.initialSave);
  const worldSeedRef = useRef(opts.world.seed);
  const worldTypeRef = useRef(opts.world.worldType);
  const worldModeRef = useRef(opts.world.gameMode);
  const worldDifficultyRef = useRef(opts.world.difficulty);
  const worldHardcoreRef = useRef(opts.world.hardcore);
  const [ctx, setCtx] = useState<GameContext | null>(null);
  const [locked, setLocked] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [rendererError, setRendererError] = useState<string | null>(null);
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
  // The live input controller — a ref (not a closure capture) so the rAF loop
  // and event drain always act on the current one, which lets a touch/desktop
  // controller swap happen without tearing down the whole renderer effect.
  const inputRef = useRef<InputController | null>(null);
  const [touchSettings, setTouchSettings] = useState<TouchSettings>(DEFAULT_TOUCH_SETTINGS);
  const touchSettingsRef = useRef(touchSettings);
  /** Non-null exactly while a touch controller drives play (the overlay's api). */
  const [touchControls, setTouchControls] = useState<TouchControlsApi | null>(null);
  const minimapNodeRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<AudioDirector | null>(null);
  // The rAF effect must not re-run on volume tweaks — it reads through a ref.
  const audioSettingsRef = useRef(audioSettings);
  const [skinId, setSkinId] = useState<SkinId>(opts.profile.skinId);
  const skinIdRef = useRef(skinId);
  const rendererRef = useRef<GameRenderer | null>(null);
  // Pending UI timers (flash messages, world-reload defers) so they can be
  // cancelled on unmount instead of firing setState/onReloadWorld after teardown.
  const pendingTimeoutsRef = useRef<Set<number>>(new Set());
  // The single in-flight toast-clear timer, so a new message cancels the old one's
  // clear instead of letting an earlier (shorter) timer wipe it early.
  const messageClearRef = useRef<number | null>(null);
  // Set by Load/Reset before they force a remount: those want to re-read (or
  // discard) the on-disk save, so the unmount must NOT persist the live state
  // over it. Consumed once by the cleanup; every other unmount saves.
  const skipUnmountSaveRef = useRef(false);

  // Audio is a global preference loaded after mount: render never touches
  // localStorage (SSR), and the setState hops a microtask like the
  // renderer-error report. This effect runs before the renderer effect (ctx is
  // set by a callback ref in a later commit), so the ref is populated by the
  // time either exists. The skin is per-profile and comes in via opts, not here.
  useEffect(() => {
    const stored = readAudioSettings();
    audioSettingsRef.current = stored;
    audioRef.current?.setSettings(stored);
    queueMicrotask(() => setAudioSettings(stored));
  }, []);

  // Same deal as audio: a global preference read after mount, through a ref so
  // the renderer effect (which builds the controller) needs no dependency.
  useEffect(() => {
    const stored = readTouchSettings();
    touchSettingsRef.current = stored;
    queueMicrotask(() => setTouchSettings(stored));
  }, []);

  /**
   * Hot-swaps the live input controller when the resolved touch mode flips —
   * no renderer teardown: the rAF loop and event drain read through inputRef.
   * Drops back to the "tap/double-click to play" gate (setLocked false via
   * release), which is also the honest UX for an input-method change.
   */
  const swapController = useCallback(() => {
    const renderer = rendererRef.current;
    const audio = audioRef.current;
    const engine = ctx?.engine;
    const current = inputRef.current;
    if (!renderer || !audio || !engine || !current) return;
    const enabled = resolveTouchEnabled(touchSettingsRef.current.mode);
    if (enabled === "controls" in current) return; // already the right kind
    current.release();
    current.dispose();
    const onLockChange = (isLocked: boolean) => {
      if (isLocked) audio.unlock();
      setLocked(isLocked);
    };
    const touchInput = enabled ? createTouchInputController({ engine, onLockChange }) : null;
    const next: InputController =
      touchInput ?? createInputController({ canvas: renderer.domElement, engine, onResize: () => renderer.handleResize(), onLockChange });
    inputRef.current = next;
    setTouchControls(touchInput?.controls ?? null);
    if (window.__monecraft) window.__monecraft.input = next;
  }, [ctx]);

  const updateTouchSettings = useCallback(
    (partial: Partial<TouchSettings>) => {
      const next = { ...touchSettingsRef.current, ...partial };
      touchSettingsRef.current = next;
      setTouchSettings(next);
      writeTouchSettings(next);
      swapController();
    },
    [swapController]
  );

  const updateAudioSettings = useCallback((partial: Partial<AudioSettings>) => {
    const next = { ...audioSettingsRef.current, ...partial };
    audioSettingsRef.current = next;
    setAudioSettings(next);
    writeAudioSettings(next);
    audioRef.current?.setSettings(next);
  }, []);

  const updateSkin = useCallback(
    (id: SkinId) => {
      skinIdRef.current = id;
      setSkinId(id);
      setProfileSkin(opts.profile.id, id);
      rendererRef.current?.setPlayerSkin(getSkinPreset(id).palette);
    },
    [opts.profile.id]
  );

  // The session is fixed for the mount (the shell keys the game subtree).
  const onlineRef = useRef(opts.online ?? null);
  // A cloud-linked single-player world (WorldMeta.cloudId) mirrors its save to
  // the server on every local save. `cloudConflict` latches once another device
  // wins a write, so we stop pushing (and warn once) rather than clobber theirs.
  const cloudIdRef = useRef(opts.world.cloudId ?? null);
  const cloudConflictRef = useRef(false);

  // Callback ref: the engine boots as soon as the canvas mount exists. A ref
  // callback runs during commit, where side effects and setState are legal.
  const attachMount = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      setCtx(null);
      return;
    }
    // Online: the session already holds the synced replica engine. Offline: a
    // saved blob carries its own seed + type + mode + difficulty (engine
    // prefers them); a fresh world boots from the world's stored values. The
    // blob was preloaded by the shell — IndexedDB reads are async, so they
    // can't happen here in the commit-phase callback.
    setCtx({
      engine:
        onlineRef.current?.engine ??
        new GameEngine({
          save: initialSaveRef.current,
          seed: worldSeedRef.current,
          worldType: worldTypeRef.current,
          gameMode: worldModeRef.current,
          difficulty: worldDifficultyRef.current,
          hardcore: worldHardcoreRef.current
        }),
      node
    });
  }, []);

  // The minimap container mounts independently of the canvas; the rAF loop
  // below picks it up lazily once both exist.
  const attachMinimap = useCallback((node: HTMLDivElement | null) => {
    minimapNodeRef.current = node;
  }, []);

  const engine = ctx?.engine ?? null;
  const subscribe = useMemo(() => engine?.subscribe ?? noopSubscribe, [engine]);
  const getSnapshot = useMemo(() => engine?.getSnapshot ?? (() => PRE_MOUNT_SNAPSHOT), [engine]);
  const getServerSnapshot = useCallback(() => PRE_MOUNT_SNAPSHOT, []);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Tracks each timer so unmount can cancel it; the timer also self-removes when
  // it fires so the set never grows unbounded.
  const scheduleTimeout = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      pendingTimeoutsRef.current.delete(id);
      fn();
    }, ms);
    pendingTimeoutsRef.current.add(id);
  }, []);

  useEffect(
    () => () => {
      for (const id of pendingTimeoutsRef.current) window.clearTimeout(id);
      pendingTimeoutsRef.current.clear();
    },
    []
  );

  const flashMessage = useCallback((text: string, durationMs = 1200) => {
    setSaveMessage(text);
    // Replace any pending clear: toasts often arrive in the same burst (an unlock
    // alongside a pickedUp/autosave toast), and an older short timer must not wipe
    // a newer message — nor this timer clear the message that follows it.
    if (messageClearRef.current !== null) {
      window.clearTimeout(messageClearRef.current);
      pendingTimeoutsRef.current.delete(messageClearRef.current);
    }
    const id = window.setTimeout(() => {
      pendingTimeoutsRef.current.delete(id);
      messageClearRef.current = null;
      setSaveMessage("");
    }, durationMs);
    pendingTimeoutsRef.current.add(id);
    messageClearRef.current = id;
  }, []);

  // Mirror a cloud-linked SP save up after a local write (fire-and-forget so the
  // fetch survives an unmount). `notify` toasts once on a losing write, so the
  // player knows another device took over — we then stop pushing to avoid a
  // last-writer-wins clobber; the next open pulls their save.
  const syncCloudSave = useCallback(
    (engine: GameApi, notify: boolean) => {
      const cloudId = cloudIdRef.current;
      if (!cloudId || onlineRef.current || cloudConflictRef.current) return;
      void pushSave(cloudId, engine.serialize()).then((result) => {
        if (result === "conflict") {
          cloudConflictRef.current = true;
          if (notify) flashMessage("This world changed on another device — your changes here won't sync. Reopen to catch up.");
        }
      });
    },
    [flashMessage]
  );

  useEffect(() => {
    if (!ctx) return;
    const { engine: gameEngine, node } = ctx;

    const created = GameRenderer.create(node);
    if (!created.ok) {
      // Microtask: reporting an init failure from inside the effect body
      // would count as a cascading synchronous setState.
      queueMicrotask(() => setRendererError(created.error));
      return;
    }
    const renderer = created.renderer;
    rendererRef.current = renderer;
    // Before the first rAF, so no frame can ever show the default palette.
    renderer.setPlayerSkin(getSkinPreset(skinIdRef.current).palette);
    const onlineForNames = onlineRef.current;
    if (onlineForNames) renderer.remotePlayerInfo = (id) => ({ name: onlineForNames.playerName(id), skinId: null });

    const audio = createAudioDirector();
    audio.setSettings(audioSettingsRef.current);
    audioRef.current = audio;
    const onLockChange = (isLocked: boolean) => {
      // Engaging play is itself a user gesture (pointer-lock click / tap) — a
      // safe unlock point, and it re-resumes a context the browser suspended.
      if (isLocked) audio.unlock();
      setLocked(isLocked);
    };
    const touchEnabled = resolveTouchEnabled(touchSettingsRef.current.mode);
    const touchInput = touchEnabled ? createTouchInputController({ engine: gameEngine, onLockChange }) : null;
    const input: InputController =
      touchInput ?? createInputController({ canvas: renderer.domElement, engine: gameEngine, onResize: () => renderer.handleResize(), onLockChange });
    inputRef.current = input;
    queueMicrotask(() => setTouchControls(touchInput?.controls ?? null));
    // Everything below must reach the controller through the ref, never the
    // `input` closure — after a hot swap the closure points at a disposed one.
    const liveInput = () => inputRef.current ?? input;
    // The touch controller is DOM-free, so the shell covers resize + rotation.
    // Registered unconditionally (a redundant handleResize is idempotent on
    // desktop) so a mid-game controller hot-swap never orphans the listeners.
    const onViewportChange = () => renderer.handleResize();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", onViewportChange);

    // Autoplay policy: the AudioContext may only start inside a user gesture.
    // pointerdown matters on touch: touch-action none can suppress the
    // synthetic mousedown the desktop path relies on.
    const unlockAudio = () => audio.unlock();
    document.addEventListener("mousedown", unlockAudio);
    document.addEventListener("keydown", unlockAudio);
    document.addEventListener("pointerdown", unlockAudio);

    // The world id is fixed for the mount's life (the shell keys this hook by
    // world id), so capture it once — also keeps it out of the cleanup's ref read.
    // Online worlds never persist locally: the SERVER persists them.
    const online = onlineRef.current;
    const worldId = worldIdRef.current;
    const autoSave = () => {
      // The skip flag also gates the interval and unload flushes: while a
      // Load/Reset (or hardcore delete) awaits its remount, a save firing in
      // that window would resurrect the blob being re-read or discarded.
      if (online || skipUnmountSaveRef.current) return;
      persistGame(gameEngine, worldId, flashMessage);
      syncCloudSave(gameEngine, true);
    };
    const autoSaveId = window.setInterval(autoSave, AUTOSAVE_INTERVAL_MS);
    // The unload flush rides beforeunload + visibilitychange(hidden) +
    // pagehide. flushWrite starts the put synchronously on the warm connection
    // and commits it explicitly (a same-tab reload's boot read then queues
    // behind it). beforeunload matters: it fires before the navigation commits,
    // so its transaction has the most teardown headroom — measured in headless
    // Chromium, the visibilitychange/pagehide flushes alone lose the commit
    // race a large fraction of reloads. Its cost is back/forward-cache
    // eligibility in Firefox/Safari — save durability wins. The other two
    // cover mobile app-switch/close, where beforeunload never fired reliably.
    // Silent: a tab switch shouldn't toast "Saved".
    const flushSave = () => {
      if (online || skipUnmountSaveRef.current) return;
      worldSaves.flushWrite(worldId, gameEngine.serialize());
      syncCloudSave(gameEngine, true);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushSave();
    };
    window.addEventListener("beforeunload", flushSave);
    window.addEventListener("pagehide", flushSave);
    document.addEventListener("visibilitychange", onVisibilityChange);

    window.__monecraft = { engine: gameEngine, renderer, input: liveInput(), audio, net: online ?? undefined };

    let minimap: MinimapRenderer | null = null;
    let animationFrame = 0;
    // Catch-up stepping (createAccumulator): bounded substeps keep sim time
    // tracking wall time on slow frames — see lib/game/engine/tickDriver.ts.
    const accumulator = createAccumulator({ startMs: performance.now() });
    const clock = () => {
      const now = performance.now();
      const frameSeconds = accumulator.advance(now, (dt) => gameEngine.step(dt, liveInput().input));

      // Online: replicated server events (mob deaths, other players' block
      // edits, …) join the local drain so toasts/audio/particles treat them
      // exactly like local ones.
      const events = online ? [...gameEngine.consumeEvents(), ...online.drainEvents()] : gameEngine.consumeEvents();
      for (const event of events) {
        // Advancement unlocks broadcast to the whole room; only surface (toast +
        // chime) your own — the server tags each with the earning player.
        if (online && event.type === "advancementUnlocked" && event.playerId && event.playerId !== online.playerId) continue;
        if (event.type === "died" || event.type === "bossDefeated" || event.type === "gameOver") {
          // Free the cursor so the death/victory/game-over button is clickable; the
          // pause command ignores those states, so the lock-loss won't open the menu too.
          liveInput().clearKeys();
          liveInput().release();
        }
        // Hardcore permadeath is permanent — persist it now so closing the tab right
        // after death still reloads the dead world spectating (not a fresh run).
        if (event.type === "gameOver" && !online) {
          persistGame(gameEngine, worldId, () => {});
          syncCloudSave(gameEngine, false);
        }
        if (event.type === "respawned") liveInput().clearKeys();
        if (event.type === "attackSwung") renderer.triggerSwing();
        if (event.type === "openedStation" || event.type === "openedContainer") {
          // A furnace/chest opened the inventory from a mouse click — release the
          // keys and pointer lock the same way KeyI does on the DOM side.
          liveInput().clearKeys();
          liveInput().release();
        }
        if (event.type === "breakBlocked") {
          flashMessage("Not enough room to empty the chest");
        }
        if (event.type === "sleepDenied") {
          flashMessage(
            event.reason === "daylight" ? "You can only sleep at night" : event.reason === "dimension" ? "You can't sleep here" : "Monsters are nearby"
          );
        }
        if (event.type === "portalDenied") {
          flashMessage(event.reason === "online" ? "Portals aren't available in online worlds yet" : "The frame is incomplete");
        }
        if (event.type === "pickedUp") {
          flashMessage(event.items.map((drop) => `+${drop.count} ${ITEM_DEF_BY_ID[drop.itemId]?.label ?? drop.itemId}`).join(", "));
        }
        if (event.type === "fishingCaught") {
          // Common fish/junk stay diegetic (splash + sound); only the rare treasure earns a toast.
          const treasure = event.items.find((drop) => drop.itemId === "emerald");
          if (treasure) flashMessage(`Reeled in treasure: ${ITEM_DEF_BY_ID[treasure.itemId]?.label ?? treasure.itemId}!`);
        }
        if (event.type === "summonFailed") {
          flashMessage("The totem lies dormant — a beast already walks");
        }
        if (event.type === "advancementUnlocked") {
          flashMessage(`Advancement Unlocked: ${event.name}`, 2400);
        }
        if (event.type === "raidStarted") {
          flashMessage(`A raid is coming — defend the village! (${event.totalWaves} waves)`, 2400);
        }
        if (event.type === "raidFailed") {
          flashMessage("A raid is already underway");
        }
        if (event.type === "raidWaveStarted") {
          flashMessage(`Raid wave ${event.wave} / ${event.totalWaves}`, 1800);
        }
        if (event.type === "raidWon") {
          flashMessage("The village holds! Raid defended.", 2400);
        }
        if (event.type === "raidLost") {
          flashMessage("The village has fallen...", 2400);
        }
        renderer.handleEvent(event, gameEngine.state);
        audio.handleEvent(event);
      }

      online?.afterFrame(now);
      if (!minimap && minimapNodeRef.current) minimap = createMinimapRenderer(minimapNodeRef.current);
      // The minimap must read worldMeshDirty before renderer.sync clears it.
      minimap?.sync(gameEngine.state, now);
      renderer.sync(gameEngine.state, now);
      audio.sync(gameEngine.state, frameSeconds);
      renderer.render();
      animationFrame = requestAnimationFrame(clock);
    };
    animationFrame = requestAnimationFrame(clock);

    return () => {
      // Persist on teardown so progress survives an unmount that fires no
      // page-lifecycle event — most importantly dev Fast Refresh, which remounts
      // the component (losing everything since the last 15s autosave) without a
      // page reload. The write is enqueued, and the remount's gate read is
      // ordered after it by the save store. Silent (no "Saved" toast) and
      // skipped for Load/Reset, which intentionally re-read or discard the
      // on-disk save.
      if (skipUnmountSaveRef.current) skipUnmountSaveRef.current = false;
      else if (!online) {
        persistGame(gameEngine, worldId, () => {});
        syncCloudSave(gameEngine, false); // flush to cloud on leave/unmount (covers Save & Quit)
      }
      online?.dispose();
      delete window.__monecraft;
      rendererRef.current = null;
      minimap?.dispose();
      cancelAnimationFrame(animationFrame);
      window.clearInterval(autoSaveId);
      window.removeEventListener("beforeunload", flushSave);
      window.removeEventListener("pagehide", flushSave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("mousedown", unlockAudio);
      document.removeEventListener("keydown", unlockAudio);
      document.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("orientationchange", onViewportChange);
      audioRef.current = null;
      audio.dispose();
      liveInput().release();
      liveInput().dispose();
      inputRef.current = null;
      setTouchControls(null);
      renderer.dispose();
    };
  }, [ctx, flashMessage, syncCloudSave]);

  // Re-entering play goes through the controller's engage() — pointer lock on
  // desktop (which can legitimately reject, e.g. Chrome's cooldown right after
  // Escape; the player just clicks the canvas again), a virtual flag on touch.
  const engageControls = useCallback(() => {
    inputRef.current?.engage();
  }, []);

  return {
    attachMount,
    attachMinimap,
    locked,
    rendererError,
    online: opts.online ?? null,
    gameMode: snapshot.gameMode,
    difficulty: snapshot.difficulty,
    hardcore: snapshot.hardcore,
    gameOver: snapshot.gameOver,
    giveCreativeItem: (itemId: string) => engine?.dispatch({ type: "creativeGiveItem", itemId }),
    setGameMode: (mode: GameMode) => engine?.dispatch({ type: "setGameMode", mode }),
    setDifficulty: (difficulty: Difficulty) => engine?.dispatch({ type: "setDifficulty", difficulty }),
    selectedSlot: snapshot.selectedSlot,
    setSelectedSlot: (index: number) => engine?.dispatch({ type: "selectSlot", index }),
    capsActive: snapshot.capsActive,
    inventoryOpen: snapshot.inventoryOpen,
    advancementsOpen: snapshot.advancementsOpen,
    // Pulled live from the engine on render (the panel only mounts while open), so
    // play never churns the snapshot with stat values the HUD doesn't show.
    advancementState: () => snapshot.api?.advancementState() ?? { stats: [], unlocked: [] },
    toggleAdvancements: () => engine?.dispatch({ type: "toggleAdvancements" }),
    // Touch play: non-null exactly while the touch controller drives input.
    touchControls,
    engageControls,
    isFlying: snapshot.isFlying,
    pauseNow: () => {
      // Order matters: release() alone must not auto-pause (that chain is
      // desktop pointer-lock-loss behavior), so the explicit dispatch follows.
      inputRef.current?.release();
      engine?.dispatch({ type: "pause" });
    },
    toggleInventory: () => {
      // Mirrors KeyI's DOM-side behavior: drop held intents and leave gameplay
      // capture before the panel opens (both are idempotent no-ops on close).
      inputRef.current?.clearKeys();
      inputRef.current?.release();
      engine?.dispatch({ type: "toggleInventory" });
    },
    toggleCameraView: () => engine?.dispatch({ type: "toggleCameraView" }),
    clearControlKeys: () => inputRef.current?.clearKeys(),
    touchMode: touchSettings.mode,
    updateTouchSettings,
    unstuckNow: () => engine?.dispatch({ type: "unstuck" }),
    inventory: snapshot.inventory,
    equippedArmor: snapshot.equippedArmor,
    armorPoints: snapshot.armorPoints,
    hearts: snapshot.hearts,
    hunger: snapshot.hunger,
    oxygen: snapshot.oxygen,
    daylightPercent: snapshot.daylightPercent,
    passiveCount: snapshot.passiveCount,
    hostileCount: snapshot.hostileCount,
    respawnSeconds: snapshot.respawnSeconds,
    paused: snapshot.paused,
    sleeping: snapshot.sleeping,
    craftingStation: snapshot.craftingStation,
    activeVillagerProfession: snapshot.activeVillagerProfession,
    container: snapshot.container,
    boss: snapshot.boss,
    treasure: snapshot.treasure,
    victory: snapshot.victory,
    activeEffects: snapshot.activeEffects,
    xpLevel: snapshot.xpLevel,
    xpProgress: snapshot.xpProgress,
    debugOpen: snapshot.debugOpen,
    debug: snapshot.debug,
    saveMessage,
    audioSettings,
    updateAudioSettings,
    skinId,
    updateSkin,
    hotbarSlots: HOTBAR_SLOTS,
    recipes: RECIPES,
    maxHearts: MAX_HEARTS,
    maxHunger: MAX_HUNGER,
    maxOxygen: MAX_OXYGEN,
    canCraft: (recipe: Recipe) => inv.canCraft(snapshot.inventory, recipe),
    craft: (recipe: Recipe) => engine?.dispatch({ type: "craft", recipeId: recipe.id }),
    enchant: (id: EnchantmentId) => engine?.dispatch({ type: "enchant", enchant: id }),
    anvilCombine: () => engine?.dispatch({ type: "anvilCombine" }),
    anvilRepair: () => engine?.dispatch({ type: "anvilRepair" }),
    anvilRename: (name: string) => engine?.dispatch({ type: "anvilRename", name }),
    grindstoneStrip: () => engine?.dispatch({ type: "grindstoneStrip" }),
    swapInventorySlots: (from: number, to: number) => engine?.dispatch({ type: "swapSlots", from, to }),
    moveStack: (from: number, to: number) => engine?.dispatch({ type: "moveStack", from, to }),
    toggleEquipArmor: (index: number) => engine?.dispatch({ type: "toggleEquipArmor", index }),
    unequipArmor: (slot: ArmorSlot) => engine?.dispatch({ type: "unequipArmor", slot }),
    resumeNow: () => {
      engine?.dispatch({ type: "resume" });
      engageControls();
    },
    respawnNow: () => engine?.dispatch({ type: "respawn" }),
    dismissVictory: () => engine?.dispatch({ type: "dismissVictory" }),
    saveNow: () => {
      if (onlineRef.current) flashMessage("The server saves online worlds");
      else if (engine) {
        persistGame(engine, worldIdRef.current, flashMessage);
        syncCloudSave(engine, true);
      }
    },
    loadNow: () => {
      void worldSaves.read(worldIdRef.current).then((save) => {
        if (!save) {
          flashMessage("No save found", 1400);
          return;
        }
        flashMessage("Loaded");
        // Remount this world (no page reload) so the engine re-reads the saved blob.
        // Suppress the unmount save so it can't overwrite the blob we're reloading.
        skipUnmountSaveRef.current = true;
        scheduleTimeout(() => opts.onReloadWorld(), 120);
      });
    },
    resetNow: () => {
      setSaveMessage("Resetting...");
      void worldSaves.remove(worldIdRef.current).then(
        () => {
          // Remount with no blob: the fresh engine regenerates from the stored seed.
          // Suppress the unmount save so it can't rewrite the blob we just removed.
          skipUnmountSaveRef.current = true;
          scheduleTimeout(() => opts.onReloadWorld(), 500);
        },
        () => flashMessage("Reset failed")
      );
    },
    quitToWorlds: () => {
      // The autosave interval is cleared on unmount and no unload event fires
      // on an in-app navigation, so persist before leaving. The write is only
      // enqueued, but an immediate re-open reads through the store's queue.
      // Online: the unmount cleanup disposes the session; the server persists.
      if (engine && !onlineRef.current) persistGame(engine, worldIdRef.current, flashMessage);
      opts.onQuitToWorlds();
    },
    /**
     * Arms the same skip flag Load/Reset use, for unmounts that must not
     * persist — the hardcore-delete path, where the teardown save would
     * recreate the blob the shell just removed. (The gameOver force-save
     * already persisted the dead world; only spectator drift is dropped.)
     */
    suppressUnmountSave: () => {
      skipUnmountSaveRef.current = true;
    }
  };
}
