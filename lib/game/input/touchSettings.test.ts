import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TOUCH_SETTINGS,
  isTouchDevice,
  readTouchSettings,
  resolveTouchEnabled,
  TOUCH_SETTINGS_KEY,
  writeTouchSettings,
  type DetectionWindow
} from "./touchSettings";

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    }
  } as Storage;
}

function fakeWindow(coarse: boolean, touchPoints: number): DetectionWindow {
  return {
    matchMedia: (query: string) => ({ matches: query === "(pointer: coarse)" && coarse }),
    navigator: { maxTouchPoints: touchPoints }
  };
}

describe("touch settings persistence", () => {
  test("round-trips each mode", () => {
    const storage = fakeStorage();
    for (const mode of ["auto", "on", "off"] as const) {
      writeTouchSettings({ mode }, storage);
      expect(readTouchSettings(storage)).toEqual({ mode });
    }
  });

  test("missing, corrupt, and unknown-mode data fall back to the default", () => {
    expect(readTouchSettings(fakeStorage())).toEqual(DEFAULT_TOUCH_SETTINGS);
    expect(readTouchSettings(fakeStorage({ [TOUCH_SETTINGS_KEY]: "not json{" }))).toEqual(DEFAULT_TOUCH_SETTINGS);
    expect(readTouchSettings(fakeStorage({ [TOUCH_SETTINGS_KEY]: JSON.stringify({ mode: "sideways" }) }))).toEqual(DEFAULT_TOUCH_SETTINGS);
    expect(readTouchSettings(fakeStorage({ [TOUCH_SETTINGS_KEY]: JSON.stringify(null) }))).toEqual(DEFAULT_TOUCH_SETTINGS);
  });

  test("a write failure is swallowed, never thrown", () => {
    const throwing = {
      ...fakeStorage(),
      setItem: () => {
        throw new Error("quota");
      }
    } as Storage;
    expect(() => writeTouchSettings({ mode: "on" }, throwing)).not.toThrow();
  });
});

describe("device detection and mode resolution", () => {
  test("auto requires BOTH a coarse primary pointer and touch points", () => {
    expect(isTouchDevice(fakeWindow(true, 5))).toBe(true);
    expect(isTouchDevice(fakeWindow(true, 0))).toBe(false); // coarse TV, no touch
    expect(isTouchDevice(fakeWindow(false, 10))).toBe(false); // touchscreen laptop, mouse primary
    expect(isTouchDevice(fakeWindow(false, 0))).toBe(false);
  });

  test("the full mode x device matrix", () => {
    const phone = fakeWindow(true, 5);
    const desktop = fakeWindow(false, 0);
    expect(resolveTouchEnabled("auto", phone)).toBe(true);
    expect(resolveTouchEnabled("auto", desktop)).toBe(false);
    expect(resolveTouchEnabled("on", desktop)).toBe(true); // explicit override wins
    expect(resolveTouchEnabled("off", phone)).toBe(false);
  });

  test("a matchMedia that throws resolves to not-touch", () => {
    const broken: DetectionWindow = {
      matchMedia: () => {
        throw new Error("unsupported");
      },
      navigator: { maxTouchPoints: 5 }
    };
    expect(isTouchDevice(broken)).toBe(false);
    expect(resolveTouchEnabled("auto", broken)).toBe(false);
  });
});
