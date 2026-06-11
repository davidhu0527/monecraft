"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AUTOSAVE_INTERVAL_MS, HOTBAR_SLOTS, MAX_HUNGER, MAX_HEARTS, SAVE_KEY } from "@/lib/game/config";
import { GameEngine } from "@/lib/game/engine/GameEngine";
import type { GameApi, GameSnapshot } from "@/lib/game/engine/state";
import { createInputController, type InputController } from "@/lib/game/input/inputController";
import * as inv from "@/lib/game/inventory";
import { createEmptyArmorEquipment, createInitialInventory } from "@/lib/game/items";
import { RECIPES } from "@/lib/game/recipes";
import { GameRenderer } from "@/lib/game/render/GameRenderer";
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
  armorPoints: 0,
  capsActive: false
};

const noopSubscribe = () => () => {};

type GameContext = { engine: GameEngine; node: HTMLDivElement };

// Debug/test handle: lets the browser console and the Playwright E2E suite
// inspect the live simulation (single-player client game — nothing to protect).
declare global {
  interface Window {
    __monecraft?: { engine: GameEngine; renderer: GameRenderer; input: InputController };
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

  // Callback ref: the engine boots as soon as the canvas mount exists. A ref
  // callback runs during commit, where side effects and setState are legal.
  const attachMount = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      setCtx(null);
      return;
    }
    setCtx({ engine: new GameEngine({ save: readSave(SAVE_KEY) }), node });
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

    const input = createInputController({
      canvas: renderer.domElement,
      engine: gameEngine,
      onResize: () => renderer.handleResize(),
      onLockChange: setLocked
    });

    const autoSave = () => persistGame(gameEngine, flashMessage);
    const autoSaveId = window.setInterval(autoSave, AUTOSAVE_INTERVAL_MS);
    window.addEventListener("beforeunload", autoSave);

    window.__monecraft = { engine: gameEngine, renderer, input };

    let last = performance.now();
    let animationFrame = 0;
    const clock = () => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      gameEngine.step(dt, input.input);

      for (const event of gameEngine.consumeEvents()) {
        if (event.type === "died") {
          input.clearKeys();
          if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
        }
        if (event.type === "respawned") input.clearKeys();
      }

      renderer.sync(gameEngine.state, now);
      renderer.render();
      animationFrame = requestAnimationFrame(clock);
    };
    animationFrame = requestAnimationFrame(clock);

    return () => {
      delete window.__monecraft;
      cancelAnimationFrame(animationFrame);
      window.clearInterval(autoSaveId);
      window.removeEventListener("beforeunload", autoSave);
      input.dispose();
      document.exitPointerLock();
      renderer.dispose();
    };
  }, [ctx, flashMessage]);

  const heartDisplay = useMemo(() => Array.from({ length: MAX_HEARTS }, (_, i) => i < snapshot.hearts), [snapshot.hearts]);
  const selectedSlotData = snapshot.inventory[snapshot.selectedSlot]?.id ? snapshot.inventory[snapshot.selectedSlot] : undefined;

  return {
    attachMount,
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
    saveMessage,
    heartDisplay,
    selectedSlotData,
    hotbarSlots: HOTBAR_SLOTS,
    recipes: RECIPES,
    maxHearts: MAX_HEARTS,
    maxHunger: MAX_HUNGER,
    canCraft: (recipe: Recipe) => inv.canCraft(snapshot.inventory, recipe),
    craft: (recipe: Recipe) => engine?.dispatch({ type: "craft", recipeId: recipe.id }),
    swapInventorySlots: (from: number, to: number) => engine?.dispatch({ type: "swapSlots", from, to }),
    toggleEquipArmor: (index: number) => engine?.dispatch({ type: "toggleEquipArmor", index }),
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
