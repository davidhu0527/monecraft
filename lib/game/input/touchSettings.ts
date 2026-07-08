/**
 * Touch-controls preference: whether the on-screen controls (virtual joystick,
 * look pad, action buttons) replace the keyboard/mouse controller. "auto"
 * follows device detection; "on"/"off" are explicit overrides for when the
 * heuristic guesses wrong (hybrid laptops, tablets with keyboards).
 */

export type TouchControlsMode = "auto" | "on" | "off";
export type TouchSettings = { mode: TouchControlsMode };

/** Own localStorage key — an input preference, not part of the world save. */
export const TOUCH_SETTINGS_KEY = "minecraft_touch_v1";

export const DEFAULT_TOUCH_SETTINGS: TouchSettings = { mode: "auto" };

const MODES: readonly TouchControlsMode[] = ["auto", "on", "off"];

// Storage is injectable so settings logic can be tested without a browser.
export function readTouchSettings(storage: Storage = localStorage): TouchSettings {
  try {
    const raw = storage.getItem(TOUCH_SETTINGS_KEY);
    if (!raw) return DEFAULT_TOUCH_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<TouchSettings> | null;
    const mode = MODES.find((m) => m === parsed?.mode);
    return { mode: mode ?? DEFAULT_TOUCH_SETTINGS.mode };
  } catch {
    return DEFAULT_TOUCH_SETTINGS;
  }
}

export function writeTouchSettings(settings: TouchSettings, storage: Storage = localStorage): void {
  try {
    storage.setItem(TOUCH_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Quota/privacy-mode failures just lose the preference, never the game.
  }
}

/** The window surface detection needs — injectable for tests. */
export type DetectionWindow = {
  matchMedia: (query: string) => { matches: boolean };
  navigator: { maxTouchPoints: number };
};

/**
 * True on devices whose PRIMARY pointer is a finger. Coarse-pointer alone
 * isn't enough (some TVs report coarse without touch), and maxTouchPoints
 * alone isn't either (touchscreen laptops where the mouse is primary should
 * default to desktop controls) — both must agree for "auto" to flip.
 */
export function isTouchDevice(win: DetectionWindow = window): boolean {
  try {
    return win.matchMedia("(pointer: coarse)").matches && win.navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}

export function resolveTouchEnabled(mode: TouchControlsMode, win: DetectionWindow = window): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  return isTouchDevice(win);
}
