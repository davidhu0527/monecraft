"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createAudioDirector, DEFAULT_AUDIO_SETTINGS, type AudioDirector, type AudioSettings } from "@/lib/game/audio/audioDirector";
import { readAudioSettings, writeAudioSettings } from "@/lib/game/audio/settings";
import { AUTOSAVE_INTERVAL_MS, HOTBAR_SLOTS, MAX_HUNGER, MAX_HEARTS, MAX_OXYGEN } from "@/lib/game/config";
import { GameEngine } from "@/lib/game/engine/GameEngine";
import type { GameApi, GameSnapshot } from "@/lib/game/engine/state";
import { createInputController, type InputController } from "@/lib/game/input/inputController";
import * as inv from "@/lib/game/inventory";
import { getSkinPreset, type SkinId } from "@/lib/game/playerSkins";
import { type Profile, setProfileSkin } from "@/lib/game/profiles";
import { createEmptyArmorEquipment, createInitialInventory, ITEM_DEF_BY_ID } from "@/lib/game/items";
import { RECIPES } from "@/lib/game/recipes";
import { GameRenderer } from "@/lib/game/render/GameRenderer";
import { createMinimapRenderer, type MinimapRenderer } from "@/lib/game/render/minimap";
import { readSave, writeSave } from "@/lib/game/save";
import type { EnchantmentId, Recipe } from "@/lib/game/types";
import type { GameMode } from "@/lib/game/gameModes";
import { type WorldMeta, worldSaveKey } from "@/lib/game/worlds";

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
  isFlying: false,
  hearts: MAX_HEARTS,
  hunger: MAX_HUNGER,
  oxygen: MAX_OXYGEN,
  daylightPercent: 100,
  passiveCount: 0,
  hostileCount: 0,
  respawnSeconds: 0,
  inventoryOpen: false,
  paused: false,
  debugOpen: false,
  debug: null,
  cameraMode: "first",
  armorPoints: 0,
  capsActive: false,
  sleeping: false,
  craftingStation: null,
  container: null,
  boss: null,
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
    __monecraft?: { engine: GameEngine; renderer: GameRenderer; input: InputController; audio: AudioDirector };
  }
}

function persistGame(api: GameApi, saveKey: string, onMessage: (text: string) => void): void {
  try {
    writeSave(saveKey, api.serialize());
    onMessage("Saved");
  } catch {
    onMessage("Save failed");
  }
}

/**
 * One mounted game = one world played by one profile. The owning shell remounts
 * this hook (via a React `key` on the world id) to switch worlds, so the
 * per-world save key and the profile are fixed for the hook's lifetime.
 */
export type UseMinecraftGameOptions = {
  world: WorldMeta;
  profile: Profile;
  /** Leave this world and return to the world list (the shell unmounts us). */
  onQuitToWorlds: () => void;
  /** Re-read this world from disk by forcing a fresh mount (used by Load/Reset). */
  onReloadWorld: () => void;
};

export function useMinecraftGame(opts: UseMinecraftGameOptions) {
  // The owning shell keys this hook by world id, so the world is fixed for the
  // mount's life; capturing it once in refs lets the long-lived rAF/autosave
  // effect read the save key and seed without re-subscribing.
  const saveKeyRef = useRef(worldSaveKey(opts.world.id));
  const worldSeedRef = useRef(opts.world.seed);
  const worldTypeRef = useRef(opts.world.worldType);
  const worldModeRef = useRef(opts.world.gameMode);
  const [ctx, setCtx] = useState<GameContext | null>(null);
  const [locked, setLocked] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [rendererError, setRendererError] = useState<string | null>(null);
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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

  // Callback ref: the engine boots as soon as the canvas mount exists. A ref
  // callback runs during commit, where side effects and setState are legal.
  const attachMount = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      setCtx(null);
      return;
    }
    // A saved blob carries its own seed + type + mode (engine prefers them); a
    // fresh world (no blob yet) boots from the world's stored seed, type, and mode.
    setCtx({
      engine: new GameEngine({
        save: readSave(saveKeyRef.current),
        seed: worldSeedRef.current,
        worldType: worldTypeRef.current,
        gameMode: worldModeRef.current
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

  const flashMessage = useCallback(
    (text: string, durationMs = 1200) => {
      setSaveMessage(text);
      scheduleTimeout(() => setSaveMessage(""), durationMs);
    },
    [scheduleTimeout]
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
    canvasRef.current = renderer.domElement;
    rendererRef.current = renderer;
    // Before the first rAF, so no frame can ever show the default palette.
    renderer.setPlayerSkin(getSkinPreset(skinIdRef.current).palette);

    const audio = createAudioDirector();
    audio.setSettings(audioSettingsRef.current);
    audioRef.current = audio;
    const input = createInputController({
      canvas: renderer.domElement,
      engine: gameEngine,
      onResize: () => renderer.handleResize(),
      onLockChange: (isLocked) => {
        // Pointer-lock acquisition is itself a user gesture — a safe unlock
        // point, and it re-resumes a context suspended by the browser.
        if (isLocked) audio.unlock();
        setLocked(isLocked);
      }
    });

    // Autoplay policy: the AudioContext may only start inside a user gesture.
    const unlockAudio = () => audio.unlock();
    document.addEventListener("mousedown", unlockAudio);
    document.addEventListener("keydown", unlockAudio);

    // The save key is fixed for the mount's life (the shell keys this hook by
    // world id), so capture it once — also keeps it out of the cleanup's ref read.
    const saveKey = saveKeyRef.current;
    const autoSave = () => persistGame(gameEngine, saveKey, flashMessage);
    const autoSaveId = window.setInterval(autoSave, AUTOSAVE_INTERVAL_MS);
    window.addEventListener("beforeunload", autoSave);

    window.__monecraft = { engine: gameEngine, renderer, input, audio };

    let minimap: MinimapRenderer | null = null;
    let last = performance.now();
    let animationFrame = 0;
    // Catch-up stepping: a slow frame (software GL, busy machine) can take far
    // longer than one 50ms step, and a single clamped step would run the
    // simulation in slow motion. Bounded substeps keep sim time tracking wall
    // time; the cap bounds work per frame and quietly drops time beyond it
    // (e.g. after a background-tab stall).
    const MAX_STEP_SECONDS = 0.05;
    const MAX_SUBSTEPS = 5;
    let pendingSeconds = 0;
    const clock = () => {
      const now = performance.now();
      pendingSeconds = Math.min(pendingSeconds + (now - last) / 1000, MAX_STEP_SECONDS * MAX_SUBSTEPS);
      last = now;

      let frameSeconds = 0;
      while (pendingSeconds > 0) {
        const dt = Math.min(pendingSeconds, MAX_STEP_SECONDS);
        gameEngine.step(dt, input.input);
        pendingSeconds -= dt;
        frameSeconds += dt;
      }

      for (const event of gameEngine.consumeEvents()) {
        if (event.type === "died" || event.type === "bossDefeated") {
          // Free the cursor so the death/victory button is clickable; the pause
          // command ignores both states, so the lock-loss won't open the menu too.
          input.clearKeys();
          if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
        }
        if (event.type === "respawned") input.clearKeys();
        if (event.type === "attackSwung") renderer.triggerSwing();
        if (event.type === "openedStation" || event.type === "openedContainer") {
          // A furnace/chest opened the inventory from a mouse click — release the
          // keys and pointer lock the same way KeyI does on the DOM side.
          input.clearKeys();
          if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
        }
        if (event.type === "breakBlocked") {
          flashMessage("Not enough room to empty the chest");
        }
        if (event.type === "sleepDenied") {
          flashMessage(event.reason === "daylight" ? "You can only sleep at night" : "Monsters are nearby");
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
        renderer.handleEvent(event, gameEngine.state);
        audio.handleEvent(event);
      }

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
      // `beforeunload` — most importantly dev Fast Refresh, which remounts the
      // component (losing everything since the last 15s autosave) without a page
      // reload. Silent (no "Saved" toast) and skipped for Load/Reset, which
      // intentionally re-read or discard the on-disk save.
      if (skipUnmountSaveRef.current) skipUnmountSaveRef.current = false;
      else persistGame(gameEngine, saveKey, () => {});
      delete window.__monecraft;
      canvasRef.current = null;
      rendererRef.current = null;
      minimap?.dispose();
      cancelAnimationFrame(animationFrame);
      window.clearInterval(autoSaveId);
      window.removeEventListener("beforeunload", autoSave);
      document.removeEventListener("mousedown", unlockAudio);
      document.removeEventListener("keydown", unlockAudio);
      audioRef.current = null;
      audio.dispose();
      input.dispose();
      document.exitPointerLock();
      renderer.dispose();
    };
  }, [ctx, flashMessage]);

  // Re-locking can legitimately reject (e.g. Chrome's cooldown right after
  // Escape); the player just clicks the canvas to lock again.
  const requestPointerLock = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) Promise.resolve(canvas.requestPointerLock()).catch(() => {});
  }, []);

  return {
    attachMount,
    attachMinimap,
    locked,
    rendererError,
    gameMode: snapshot.gameMode,
    giveCreativeItem: (itemId: string) => engine?.dispatch({ type: "creativeGiveItem", itemId }),
    setGameMode: (mode: GameMode) => engine?.dispatch({ type: "setGameMode", mode }),
    selectedSlot: snapshot.selectedSlot,
    setSelectedSlot: (index: number) => engine?.dispatch({ type: "selectSlot", index }),
    capsActive: snapshot.capsActive,
    inventoryOpen: snapshot.inventoryOpen,
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
    container: snapshot.container,
    boss: snapshot.boss,
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
    swapInventorySlots: (from: number, to: number) => engine?.dispatch({ type: "swapSlots", from, to }),
    moveStack: (from: number, to: number) => engine?.dispatch({ type: "moveStack", from, to }),
    toggleEquipArmor: (index: number) => engine?.dispatch({ type: "toggleEquipArmor", index }),
    resumeNow: () => {
      engine?.dispatch({ type: "resume" });
      requestPointerLock();
    },
    respawnNow: () => engine?.dispatch({ type: "respawn" }),
    dismissVictory: () => engine?.dispatch({ type: "dismissVictory" }),
    saveNow: () => {
      if (engine) persistGame(engine, saveKeyRef.current, flashMessage);
    },
    loadNow: () => {
      if (!readSave(saveKeyRef.current)) {
        flashMessage("No save found", 1400);
        return;
      }
      flashMessage("Loaded");
      // Remount this world (no page reload) so the engine re-reads the saved blob.
      // Suppress the unmount save so it can't overwrite the blob we're reloading.
      skipUnmountSaveRef.current = true;
      scheduleTimeout(() => opts.onReloadWorld(), 120);
    },
    resetNow: () => {
      try {
        localStorage.removeItem(saveKeyRef.current);
        setSaveMessage("Resetting...");
        // Remount with no blob: the fresh engine regenerates from the stored seed.
        // Suppress the unmount save so it can't rewrite the blob we just removed.
        skipUnmountSaveRef.current = true;
        scheduleTimeout(() => opts.onReloadWorld(), 500);
      } catch {
        flashMessage("Reset failed");
      }
    },
    quitToWorlds: () => {
      // The autosave interval is cleared on unmount and beforeunload won't fire
      // on an in-app navigation, so persist synchronously before leaving.
      if (engine) persistGame(engine, saveKeyRef.current, flashMessage);
      opts.onQuitToWorlds();
    }
  };
}
