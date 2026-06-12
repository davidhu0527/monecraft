import { describe, expect, test } from "bun:test";
import { DEFAULT_AUDIO_SETTINGS } from "./audioDirector";
import { AUDIO_SETTINGS_KEY, readAudioSettings, writeAudioSettings } from "./settings";

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

describe("audio settings persistence", () => {
  test("round-trips through storage", () => {
    const storage = fakeStorage();
    writeAudioSettings({ master: 0.4, music: 0.1, muted: true }, storage);
    expect(readAudioSettings(storage)).toEqual({ master: 0.4, music: 0.1, muted: true });
  });

  test("missing or corrupt data falls back to defaults", () => {
    expect(readAudioSettings(fakeStorage())).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(readAudioSettings(fakeStorage({ [AUDIO_SETTINGS_KEY]: "not json{" }))).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(readAudioSettings(fakeStorage({ [AUDIO_SETTINGS_KEY]: "null" }))).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  test("out-of-range and wrong-typed fields are sanitized", () => {
    const storage = fakeStorage({
      [AUDIO_SETTINGS_KEY]: JSON.stringify({ master: 7, music: -2, muted: "yes" })
    });
    expect(readAudioSettings(storage)).toEqual({ master: 1, music: 0, muted: false });
  });
});
