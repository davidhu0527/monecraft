import { DEFAULT_SKIN_ID, isSkinId, type SkinId } from "./playerSkins";

/** Own localStorage key — the skin choice is a player preference, not part of the world save. */
export const SKIN_SETTINGS_KEY = "minecraft_skin_v1";

/** An object (not a bare id) so future appearance fields don't need a key migration. */
export type SkinSettings = {
  skinId: SkinId;
};

export const DEFAULT_SKIN_SETTINGS: SkinSettings = { skinId: DEFAULT_SKIN_ID };

// Storage is injectable so settings logic can be tested without a browser.
export function readSkinSettings(storage: Storage = localStorage): SkinSettings {
  try {
    const raw = storage.getItem(SKIN_SETTINGS_KEY);
    if (!raw) return DEFAULT_SKIN_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<SkinSettings> | null;
    return { skinId: isSkinId(parsed?.skinId) ? parsed.skinId : DEFAULT_SKIN_ID };
  } catch {
    return DEFAULT_SKIN_SETTINGS;
  }
}

export function writeSkinSettings(settings: SkinSettings, storage: Storage = localStorage): void {
  try {
    storage.setItem(SKIN_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Quota/privacy-mode failures just lose the preference, never the game.
  }
}
