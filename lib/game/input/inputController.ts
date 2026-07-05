import type { GameEngine } from "@/lib/game/engine/GameEngine";
import type { FrameInput, MoveIntents } from "@/lib/game/engine/state";
import { FLY_DOUBLE_TAP_WINDOW_SECONDS } from "@/lib/game/config";

const MOUSE_SENSITIVITY = 0.0021;

export type InputController = {
  /** Live continuous-input view (abstract intents), passed to engine.step every frame. */
  readonly input: FrameInput;
  /** Whether gameplay pointer capture is held (drives the pause-on-unlock UX). */
  readonly pointerLocked: boolean;
  /** Drops held keys and the mouse button (on death/respawn). */
  clearKeys(): void;
  /**
   * Test hook: pretend pointer lock is held. Headless Chromium cannot acquire
   * real pointer lock, so the E2E fallback forces the flag to exercise the
   * keys/mouse → engine wiring — see e2e/helpers.ts.
   */
  forcePointerLock(locked: boolean): void;
  /**
   * Enter gameplay capture. Desktop: request pointer lock (may legitimately
   * reject — e.g. Chrome's cooldown right after Escape; the game just stays
   * unlocked). A touch controller flips its virtual "playing" flag instead.
   * The shell must use engage()/release() rather than poking
   * requestPointerLock/exitPointerLock directly — a controller whose lock is
   * virtual would silently desync otherwise.
   */
  engage(): void;
  /** Leave gameplay capture (release pointer lock if this controller holds it). */
  release(): void;
  dispose(): void;
};

type CreateInputControllerArgs = {
  /** The WebGL canvas — pointer lock target. */
  canvas: HTMLCanvasElement;
  engine: GameEngine;
  onResize: () => void;
  onLockChange: (locked: boolean) => void;
};

/**
 * Owns every DOM listener and the DOM→intent mapping: raw key codes, CapsLock,
 * and pointer lock stay in here; the engine sees only the abstract FrameInput
 * (a future keybinding screen changes this file alone). Discrete actions
 * become engine commands; mouse-look goes through engine.applyLook.
 */
export function createInputController(args: CreateInputControllerArgs): InputController {
  const { canvas, engine, onResize, onLockChange } = args;

  // Raw DOM-side state, reduced to intents after every change.
  const pressed = new Set<string>();
  let capsActive = false;
  let leftMouseHeld = false;
  let pointerLocked = false;

  const move: MoveIntents = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, crouch: false };
  const input: FrameInput = { move, mineHeld: false };

  const syncIntents = () => {
    move.forward = pressed.has("KeyW");
    move.back = pressed.has("KeyS");
    move.left = pressed.has("KeyA");
    move.right = pressed.has("KeyD");
    move.jump = pressed.has("Space");
    move.crouch = pressed.has("KeyC");
    move.sprint = capsActive;
    // Mining requires gameplay pointer capture; fold the gate in here so the
    // engine needs no notion of the cursor.
    input.mineHeld = leftMouseHeld && pointerLocked;
  };

  const uiBlocked = () => engine.state.inventoryOpen || engine.state.advancementsOpen || engine.state.isDead || engine.state.paused;

  // Timestamp (ms) of the last discrete Space press, for double-tap-to-fly detection.
  let lastSpaceTapAt = -Infinity;

  const onMouseMove = (evt: MouseEvent) => {
    if (!pointerLocked) return;
    engine.applyLook(-evt.movementX * MOUSE_SENSITIVITY, -evt.movementY * MOUSE_SENSITIVITY);
  };

  const onKeyDown = (evt: KeyboardEvent) => {
    // Escape under pointer lock never reaches us — the browser consumes it to
    // exit the lock, and the pointerlockchange handler below opens the menu.
    if (evt.code === "Escape") {
      if (engine.state.paused) engine.dispatch({ type: "resume" });
      else if (engine.state.inventoryOpen) engine.dispatch({ type: "toggleInventory" });
      else if (engine.state.advancementsOpen) engine.dispatch({ type: "toggleAdvancements" });
      else if (!pointerLocked) engine.dispatch({ type: "pause" });
      return;
    }

    // Render-only and engine-supported in every state, so it works even from
    // the pause menu — like Minecraft's F5.
    if (evt.code === "KeyV") {
      engine.dispatch({ type: "toggleCameraView" });
      return;
    }

    if (engine.state.paused) return;

    if (evt.code === "F3") {
      evt.preventDefault();
      engine.dispatch({ type: "toggleDebug" });
      return;
    }

    if (evt.code.startsWith("Digit")) {
      const idx = Number.parseInt(evt.code.slice(5), 10) - 1;
      if (idx >= 0) engine.dispatch({ type: "selectSlot", index: idx });
    }

    if (evt.code === "KeyI") {
      engine.dispatch({ type: "toggleInventory" });
      pressed.clear();
      syncIntents();
      if (pointerLocked) document.exitPointerLock();
      return;
    }

    if (evt.code === "KeyL") {
      engine.dispatch({ type: "toggleAdvancements" });
      pressed.clear();
      syncIntents();
      if (pointerLocked) document.exitPointerLock();
      return;
    }

    // Shift-gated so a stray `U` can't teleport the player mid-play; the 0.8s
    // auto-unstuck safeguard still covers genuine wedged-in-terrain cases.
    if (evt.shiftKey && evt.code === "KeyU") {
      engine.dispatch({ type: "unstuck" });
      return;
    }

    if (uiBlocked()) return;

    if (evt.code === "KeyE") {
      evt.preventDefault();
      engine.dispatch({ type: "placeBlock" });
    }
    if (evt.code === "KeyF") {
      evt.preventDefault();
      // One key for consumables: a held potion is drunk for its effect, anything else is eaten.
      const held = engine.state.inventory[engine.state.selectedSlot];
      engine.dispatch({ type: held?.effect ? "drinkPotion" : "eatFood" });
    }

    // Double-tap Space toggles flight (Creative/Spectator). Ignore auto-repeat
    // (held key) so only distinct presses count; the engine no-ops in modes
    // that can't fly.
    if (evt.code === "Space" && !evt.repeat) {
      const now = performance.now();
      if (now - lastSpaceTapAt <= FLY_DOUBLE_TAP_WINDOW_SECONDS * 1000) {
        engine.dispatch({ type: "toggleFlight" });
        lastSpaceTapAt = -Infinity; // consume the pair so a third tap starts fresh
      } else {
        lastSpaceTapAt = now;
      }
    }

    pressed.add(evt.code);
    capsActive = evt.getModifierState("CapsLock");
    syncIntents();
    if (evt.code === "Space") evt.preventDefault();
  };

  const onKeyUp = (evt: KeyboardEvent) => {
    pressed.delete(evt.code);
    capsActive = evt.getModifierState("CapsLock");
    syncIntents();
  };

  const onMouseDown = (evt: MouseEvent) => {
    if (uiBlocked()) return;
    if (!pointerLocked) return;

    if (evt.button === 0) {
      leftMouseHeld = true;
      syncIntents();
      engine.dispatch({ type: "attack" });
    }
    if (evt.button === 2) engine.dispatch({ type: "placeBlock" });
  };

  const onDoubleClick = () => {
    if (uiBlocked() || pointerLocked) return;
    // Starting play is deliberate: a single click remains inert, while the
    // double-click gesture acquires pointer lock without also mining.
    // The request can legitimately reject (recent Esc, unfocused document,
    // headless browsers); the game just stays unlocked.
    Promise.resolve(canvas.requestPointerLock()).catch(() => {});
  };

  const onMouseUp = (evt: MouseEvent) => {
    if (evt.button !== 0) return;
    leftMouseHeld = false;
    syncIntents();
  };

  const onContextMenu = (evt: MouseEvent) => evt.preventDefault();

  const onPointerLockChange = () => {
    pointerLocked = document.pointerLockElement === canvas;
    syncIntents();
    onLockChange(pointerLocked);
    // Losing the lock during plain gameplay means the player pressed Escape
    // (or the browser took it away) — open the pause menu. The inventory and
    // death paths set their state flags before the lock change fires, and the
    // pause command itself ignores those states as a second guard.
    if (!pointerLocked) engine.dispatch({ type: "pause" });
  };

  window.addEventListener("resize", onResize);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("mousedown", onMouseDown);
  document.addEventListener("dblclick", onDoubleClick);
  document.addEventListener("mouseup", onMouseUp);
  document.addEventListener("contextmenu", onContextMenu);
  document.addEventListener("pointerlockchange", onPointerLockChange);

  return {
    input,

    get pointerLocked() {
      return pointerLocked;
    },

    clearKeys() {
      pressed.clear();
      leftMouseHeld = false;
      syncIntents();
    },

    forcePointerLock(locked: boolean) {
      // Deliberately no onLockChange: the React shell keeps believing the
      // cursor is free (as it truly is), matching the pre-hook behavior of
      // poking the raw flag. Only the engine-facing gates are faked.
      pointerLocked = locked;
      syncIntents();
    },

    engage() {
      Promise.resolve(canvas.requestPointerLock()).catch(() => {});
    },

    release() {
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    },

    dispose() {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("dblclick", onDoubleClick);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
    }
  };
}
