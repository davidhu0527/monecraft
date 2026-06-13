/**
 * Player skin presets — palettes for the third-person body model and the
 * pause-menu portraits. Pure data: the renderer applies a palette to the
 * model's materials and lib/ui derives a pixel bust from the same colors, so
 * a preset is automatically consistent everywhere it appears.
 */

export type PlayerPalette = {
  skin: number;
  hair: number;
  shirt: number;
  pants: number;
  shoes: number;
  eyeWhite: number;
  eyePupil: number;
};

export type SkinId = "default" | "alex" | "zombie" | "skeleton" | "knight" | "robot";

export type SkinPreset = {
  id: SkinId;
  label: string;
  palette: PlayerPalette;
};

export const DEFAULT_SKIN_ID: SkinId = "default";

export const SKIN_PRESETS: readonly SkinPreset[] = [
  {
    id: "default",
    label: "Steve",
    palette: { skin: 0xc68e63, hair: 0x4a3220, shirt: 0x2e8b83, pants: 0x3b3f8f, shoes: 0x4a3527, eyeWhite: 0xffffff, eyePupil: 0x2b2b45 }
  },
  {
    id: "alex",
    label: "Alex",
    palette: { skin: 0xe6b18a, hair: 0xb5602e, shirt: 0x5f8a3a, pants: 0x6e5036, shoes: 0x57422c, eyeWhite: 0xffffff, eyePupil: 0x3f6b3a }
  },
  {
    id: "zombie",
    label: "Zombie",
    palette: { skin: 0x6a9a4e, hair: 0x4e7a3a, shirt: 0x2f6e62, pants: 0x4f4377, shoes: 0x3d3326, eyeWhite: 0x1d2b1d, eyePupil: 0x0a120a }
  },
  {
    id: "skeleton",
    label: "Skeleton",
    palette: { skin: 0xdcdcd2, hair: 0xc4c4ba, shirt: 0xb1b1a7, pants: 0x9a9a90, shoes: 0x83837a, eyeWhite: 0x2e2e2e, eyePupil: 0x121212 }
  },
  {
    id: "knight",
    // eyeWhite == eyePupil on purpose: the eye boxes merge into a dark visor slit.
    label: "Knight",
    palette: { skin: 0xaab2bd, hair: 0x7c8591, shirt: 0x8d96a3, pants: 0x646d79, shoes: 0x4a525c, eyeWhite: 0x161a20, eyePupil: 0x161a20 }
  },
  {
    id: "robot",
    label: "Robot",
    palette: { skin: 0x767f8a, hair: 0x4d545e, shirt: 0x5b636d, pants: 0x444b54, shoes: 0x32373e, eyeWhite: 0x35e9ff, eyePupil: 0x0b6f80 }
  }
];

/** The palette the body model boots with before any preference is applied. */
export const DEFAULT_PLAYER_PALETTE: PlayerPalette = SKIN_PRESETS[0].palette;

export function isSkinId(value: unknown): value is SkinId {
  return typeof value === "string" && SKIN_PRESETS.some((preset) => preset.id === value);
}

/** Resolves an id from storage/UI; unknown or corrupt ids fall back to the default preset. */
export function getSkinPreset(id: string): SkinPreset {
  return SKIN_PRESETS.find((preset) => preset.id === id) ?? SKIN_PRESETS[0];
}
