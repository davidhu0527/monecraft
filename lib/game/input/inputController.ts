import type { GameEngine } from "@/lib/game/engine/GameEngine";
import type { FrameInput } from "@/lib/game/engine/state";

const MOUSE_SENSITIVITY = 0.0021;

type MutableInput = {
  keys: Set<string>;
  capsActive: boolean;
  leftMouseHeld: boolean;
  pointerLocked: boolean;
};

export type InputController = {
  /** Live continuous-input view, passed to engine.step every frame. */
  readonly input: FrameInput;
  /** Drops held keys and the mouse button (on death/respawn). */
  clearKeys(): void;
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
 * Owns every DOM listener. Continuous input (keys, mouse button, pointer
 * lock) is exposed as a FrameInput the engine reads each step; discrete
 * actions become engine commands; mouse-look goes through engine.applyLook.
 */
export function createInputController(args: CreateInputControllerArgs): InputController {
  const { canvas, engine, onResize, onLockChange } = args;

  const input: MutableInput = {
    keys: new Set<string>(),
    capsActive: false,
    leftMouseHeld: false,
    pointerLocked: false
  };

  const uiBlocked = () => engine.state.inventoryOpen || engine.state.isDead || engine.state.paused;

  const onMouseMove = (evt: MouseEvent) => {
    if (!input.pointerLocked) return;
    engine.applyLook(-evt.movementX * MOUSE_SENSITIVITY, -evt.movementY * MOUSE_SENSITIVITY);
  };

  const onKeyDown = (evt: KeyboardEvent) => {
    // Escape under pointer lock never reaches us — the browser consumes it to
    // exit the lock, and the pointerlockchange handler below opens the menu.
    if (evt.code === "Escape") {
      if (engine.state.paused) engine.dispatch({ type: "resume" });
      else if (engine.state.inventoryOpen) engine.dispatch({ type: "toggleInventory" });
      else if (!input.pointerLocked) engine.dispatch({ type: "pause" });
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
      input.keys.clear();
      if (input.pointerLocked) document.exitPointerLock();
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

    input.keys.add(evt.code);
    input.capsActive = evt.getModifierState("CapsLock");
    if (evt.code === "Space") evt.preventDefault();
  };

  const onKeyUp = (evt: KeyboardEvent) => {
    input.keys.delete(evt.code);
    input.capsActive = evt.getModifierState("CapsLock");
  };

  const onMouseDown = (evt: MouseEvent) => {
    if (uiBlocked()) return;
    if (!input.pointerLocked) return;

    if (evt.button === 0) {
      input.leftMouseHeld = true;
      engine.dispatch({ type: "attack" });
    }
    if (evt.button === 2) engine.dispatch({ type: "placeBlock" });
  };

  const onDoubleClick = () => {
    if (uiBlocked() || input.pointerLocked) return;
    // Starting play is deliberate: a single click remains inert, while the
    // double-click gesture acquires pointer lock without also mining.
    // The request can legitimately reject (recent Esc, unfocused document,
    // headless browsers); the game just stays unlocked.
    Promise.resolve(canvas.requestPointerLock()).catch(() => {});
  };

  const onMouseUp = (evt: MouseEvent) => {
    if (evt.button !== 0) return;
    input.leftMouseHeld = false;
  };

  const onContextMenu = (evt: MouseEvent) => evt.preventDefault();

  const onPointerLockChange = () => {
    input.pointerLocked = document.pointerLockElement === canvas;
    onLockChange(input.pointerLocked);
    // Losing the lock during plain gameplay means the player pressed Escape
    // (or the browser took it away) — open the pause menu. The inventory and
    // death paths set their state flags before the lock change fires, and the
    // pause command itself ignores those states as a second guard.
    if (!input.pointerLocked) engine.dispatch({ type: "pause" });
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

    clearKeys() {
      input.keys.clear();
      input.leftMouseHeld = false;
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
