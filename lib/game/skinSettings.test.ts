import { describe, expect, test } from "bun:test";
import { DEFAULT_SKIN_SETTINGS, readSkinSettings, SKIN_SETTINGS_KEY, writeSkinSettings } from "./skinSettings";

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value)
  };
}

describe("skin settings persistence", () => {
  test("round-trips through storage", () => {
    const storage = fakeStorage();
    writeSkinSettings({ skinId: "robot" }, storage);
    expect(readSkinSettings(storage)).toEqual({ skinId: "robot" });
  });

  test("missing or corrupt data falls back to the default skin", () => {
    expect(readSkinSettings(fakeStorage())).toEqual(DEFAULT_SKIN_SETTINGS);
    expect(readSkinSettings(fakeStorage({ [SKIN_SETTINGS_KEY]: "not json{" }))).toEqual(DEFAULT_SKIN_SETTINGS);
    expect(readSkinSettings(fakeStorage({ [SKIN_SETTINGS_KEY]: "null" }))).toEqual(DEFAULT_SKIN_SETTINGS);
  });

  test("unknown or wrong-typed skin ids are sanitized to the default", () => {
    expect(readSkinSettings(fakeStorage({ [SKIN_SETTINGS_KEY]: JSON.stringify({ skinId: "herobrine" }) }))).toEqual(DEFAULT_SKIN_SETTINGS);
    expect(readSkinSettings(fakeStorage({ [SKIN_SETTINGS_KEY]: JSON.stringify({ skinId: 7 }) }))).toEqual(DEFAULT_SKIN_SETTINGS);
  });

  test("write failures are swallowed", () => {
    const storage = fakeStorage();
    storage.setItem = () => {
      throw new Error("quota");
    };
    expect(() => writeSkinSettings({ skinId: "alex" }, storage)).not.toThrow();
  });
});
