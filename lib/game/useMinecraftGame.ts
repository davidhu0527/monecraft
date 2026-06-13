"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createAudioDirector, DEFAULT_AUDIO_SETTINGS, type AudioDirector, type AudioSettings } from "@/lib/game/audio/audioDirector";
import { readAudioSettings, writeAudioSettings } from "@/lib/game/audio/settings";
import { AUTOSAVE_INTERVAL_MS, HOTBAR_SLOTS, MAX_HUNGER, MAX_HEARTS, SAVE_KEY } from "@/lib/game/config";
import { GameEngine } from "@/lib/game/engine/GameEngine";
import type { GameApi, GameSnapshot } from "@/lib/game/engine/state";
import { createInputController, type InputController } from "@/lib/game/input/inputController";
import * as inv from "@/lib/game/inventory";
import { DEFAULT_SKIN_ID, getSkinPreset, type SkinId } from "@/lib/game/playerSkins";
import { readSkinSettings, writeSkinSettings } from "@/lib/game/skinSettings";
import { createEmptyArmorEquipment, createInitialInventory } from "@/lib/game/items";
import { RECIPES } from "@/lib/game/recipes";
import { GameRenderer } from "@/lib/game/render/GameRenderer";
import { createMinimapRenderer, type MinimapRenderer } from "@/lib/game/render/minimap";
import { readSave, writeSave } from "@/lib/game/save";
import type { Recipe } from "@/lib/game/types";

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
  hearts: MAX_HEARTS,
  hunger: MAX_HUNGER,
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
  craftingStation: null
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

function persistGame(api: GameApi, onMessage: (text: string) => void): void {
  try {
    writeSave(SAVE_KEY, api.serialize());
    onMessage("Saved");
  } catch {
    onMessage("Save failed");
  }
}

export function useMinecraftGame() {
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
  const [skinId, setSkinId] = useState<SkinId>(DEFAULT_SKIN_ID);
  const skinIdRef = useRef(skinId);
  const rendererRef = useRef<GameRenderer | null>(null);

  // Persisted preferences load after mount: render never touches localStorage
  // (SSR), and the setState hops a microtask like the renderer-error report.
  // This effect runs before the renderer effect (ctx is set by a callback ref
  // in a later commit), so the refs are populated by the time either exists.
  useEffect(() => {
    const stored = readAudioSettings();
    audioSettingsRef.current = stored;
    audioRef.current?.setSettings(stored);
    const { skinId: storedSkin } = readSkinSettings();
    skinIdRef.current = storedSkin;
    queueMicrotask(() => {
      setAudioSettings(stored);
      setSkinId(storedSkin);
    });
  }, []);

  const updateAudioSettings = useCallback((partial: Partial<AudioSettings>) => {
    const next = { ...audioSettingsRef.current, ...partial };
    audioSettingsRef.current = next;
    setAudioSettings(next);
    writeAudioSettings(next);
    audioRef.current?.setSettings(next);
  }, []);

  const updateSkin = useCallback((id: SkinId) => {
    skinIdRef.current = id;
    setSkinId(id);
    writeSkinSettings({ skinId: id });
    rendererRef.current?.setPlayerSkin(getSkinPreset(id).palette);
  }, []);

  // Callback ref: the engine boots as soon as the canvas mount exists. A ref
  // callback runs during commit, where side effects and setState are legal.
  const attachMount = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      setCtx(null);
      return;
    }
    setCtx({ engine: new GameEngine({ save: readSave(SAVE_KEY) }), node });
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

  const flashMessage = useCallback((text: string, durationMs = 1200) => {
    setSaveMessage(text);
    window.setTimeout(() => setSaveMessage(""), durationMs);
  }, []);

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

    const autoSave = () => persistGame(gameEngine, flashMessage);
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
        if (event.type === "died") {
          input.clearKeys();
          if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
        }
        if (event.type === "respawned") input.clearKeys();
        if (event.type === "attackSwung") renderer.triggerSwing();
        if (event.type === "openedStation") {
          // A furnace opened the inventory from a mouse click — release the keys
          // and pointer lock the same way KeyI does on the DOM side.
          input.clearKeys();
          if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
        }
        if (event.type === "sleepDenied") {
          flashMessage(event.reason === "daylight" ? "You can only sleep at night" : "Monsters are nearby");
        }
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
    selectedSlot: snapshot.selectedSlot,
    setSelectedSlot: (index: number) => engine?.dispatch({ type: "selectSlot", index }),
    capsActive: snapshot.capsActive,
    inventoryOpen: snapshot.inventoryOpen,
    inventory: snapshot.inventory,
    equippedArmor: snapshot.equippedArmor,
    armorPoints: snapshot.armorPoints,
    hearts: snapshot.hearts,
    hunger: snapshot.hunger,
    daylightPercent: snapshot.daylightPercent,
    passiveCount: snapshot.passiveCount,
    hostileCount: snapshot.hostileCount,
    respawnSeconds: snapshot.respawnSeconds,
    paused: snapshot.paused,
    sleeping: snapshot.sleeping,
    craftingStation: snapshot.craftingStation,
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
    canCraft: (recipe: Recipe) => inv.canCraft(snapshot.inventory, recipe),
    craft: (recipe: Recipe) => engine?.dispatch({ type: "craft", recipeId: recipe.id }),
    swapInventorySlots: (from: number, to: number) => engine?.dispatch({ type: "swapSlots", from, to }),
    toggleEquipArmor: (index: number) => engine?.dispatch({ type: "toggleEquipArmor", index }),
    resumeNow: () => {
      engine?.dispatch({ type: "resume" });
      requestPointerLock();
    },
    respawnNow: () => engine?.dispatch({ type: "respawn" }),
    saveNow: () => {
      if (engine) persistGame(engine, flashMessage);
    },
    loadNow: () => {
      if (!readSave(SAVE_KEY)) {
        flashMessage("No save found", 1400);
        return;
      }
      flashMessage("Loaded");
      window.setTimeout(() => window.location.reload(), 120);
    },
    resetNow: () => {
      try {
        localStorage.removeItem(SAVE_KEY);
        setSaveMessage("Resetting...");
        window.setTimeout(() => window.location.reload(), 500);
      } catch {
        flashMessage("Reset failed");
      }
    }
  };
}
