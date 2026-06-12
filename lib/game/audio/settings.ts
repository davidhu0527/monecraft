import { DEFAULT_AUDIO_SETTINGS, type AudioSettings } from "./audioDirector";

/** Own localStorage key — volume preferences are not part of the world save. */
export const AUDIO_SETTINGS_KEY = "minecraft_audio_v1";

function clamp01(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

// Storage is injectable so settings logic can be tested without a browser.
export function readAudioSettings(storage: Storage = localStorage): AudioSettings {
  try {
    const raw = storage.getItem(AUDIO_SETTINGS_KEY);
    if (!raw) return DEFAULT_AUDIO_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AudioSettings> | null;
    return {
      master: clamp01(parsed?.master, DEFAULT_AUDIO_SETTINGS.master),
      music: clamp01(parsed?.music, DEFAULT_AUDIO_SETTINGS.music),
      muted: parsed?.muted === true
    };
  } catch {
    return DEFAULT_AUDIO_SETTINGS;
  }
}

export function writeAudioSettings(settings: AudioSettings, storage: Storage = localStorage): void {
  try {
    storage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Quota/privacy-mode failures just lose the preference, never the game.
  }
}
