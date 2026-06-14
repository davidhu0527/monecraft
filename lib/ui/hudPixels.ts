import { paintGrid, SPRITE_SIZE, type PixelPalette } from "./spritePixels";

/**
 * Procedural HUD icons: hearts, hunger drumsticks, and armor — each as
 * container (empty), full, and half variants, Minecraft-style. Pure pixel
 * buffers; sprites.ts turns them into data URLs.
 */

const HEART_GRID = [
  "................",
  "..ooo.....ooo...",
  ".ommmo...ommmo..",
  "ommlmmo.ommmmmo.",
  "omllmmmmmmmmmmo.",
  "ommmmmmmmmmmmmo.",
  "ommmmmmmmmmmmmo.",
  ".ommmmmmmmmmmo..",
  "..ommmmmmmmmo...",
  "...ommmmmmmo....",
  "....ommmmmo.....",
  ".....ommmo......",
  "......omo.......",
  ".......o........",
  "................",
  "................"
];

const DRUMSTICK_GRID = [
  "................",
  ".......ooooo....",
  "......ommmmmo...",
  ".....ommllmmmo..",
  ".....ommllmmmo..",
  "....ommmmmmmmo..",
  "....ommmmmmmo...",
  "...ommmmmmmo....",
  "...ommmmmmo.....",
  "....ommmoo......",
  "....obmo........",
  "...obbo.........",
  "..obbo..........",
  ".owbbo..........",
  ".owwo...........",
  "..oo............"
];

const ARMOR_GRID = [
  "................",
  "..ooo......ooo..",
  "..ommoooooommo..",
  "..ommmllmmmmmo..",
  "..ommmmmmmmmmo..",
  "..oo.ommmmo.oo..",
  ".....ommmmo.....",
  ".....ommmmo.....",
  ".....ommmmo.....",
  ".....ommmmo.....",
  ".....oommoo.....",
  "......oooo......",
  "................",
  "................",
  "................",
  "................"
];

const BUBBLE_GRID = [
  "................",
  "................",
  "......oooo......",
  "....oommmmoo....",
  "...ommllmmmo....",
  "..ommlmmmmmo....",
  "..ommmmmmmmo....",
  ".ommmmmmmmmmo...",
  ".ommmmmmmmmmo...",
  "..ommmmmmmmo....",
  "..ommmmmmmmo....",
  "...ommmmmmo.....",
  "....oommoo......",
  "......oo........",
  "................",
  "................"
];

const HEART_PALETTE: PixelPalette = {
  o: [56, 10, 10],
  m: [228, 38, 38],
  l: [255, 142, 142]
};

const DRUMSTICK_PALETTE: PixelPalette = {
  o: [70, 36, 14],
  m: [198, 118, 56],
  l: [236, 170, 104],
  b: [236, 222, 192],
  w: [252, 248, 240]
};

const ARMOR_PALETTE: PixelPalette = {
  o: [42, 44, 50],
  m: [196, 201, 211],
  l: [240, 243, 248]
};

const BUBBLE_PALETTE: PixelPalette = {
  o: [20, 60, 80],
  m: [90, 200, 235],
  l: [220, 250, 255]
};

// Containers reuse the same shapes as dark sunken outlines.
const HEART_CONTAINER_PALETTE: PixelPalette = { o: [30, 6, 6], m: [62, 26, 26], l: [80, 38, 38] };
const DRUMSTICK_CONTAINER_PALETTE: PixelPalette = { o: [34, 20, 8], m: [66, 44, 24], l: [80, 56, 32], b: [70, 58, 40], w: [78, 66, 48] };
const ARMOR_CONTAINER_PALETTE: PixelPalette = { o: [22, 23, 26], m: [58, 61, 68], l: [74, 78, 86] };
const BUBBLE_CONTAINER_PALETTE: PixelPalette = { o: [16, 30, 38], m: [40, 70, 84], l: [60, 96, 110] };

/** Left half of `full` over `container` — the classic half-heart/half-drumstick. */
function halfIcon(full: Uint8ClampedArray, container: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(container);
  for (let y = 0; y < SPRITE_SIZE; y += 1) {
    for (let x = 0; x < SPRITE_SIZE / 2; x += 1) {
      const i = (y * SPRITE_SIZE + x) * 4;
      if (full[i + 3] === 0) continue;
      out[i] = full[i];
      out[i + 1] = full[i + 1];
      out[i + 2] = full[i + 2];
      out[i + 3] = full[i + 3];
    }
  }
  return out;
}

export type HudIconName =
  | "heart_full"
  | "heart_half"
  | "heart_container"
  | "hunger_full"
  | "hunger_half"
  | "hunger_container"
  | "armor_full"
  | "armor_half"
  | "armor_container"
  | "bubble_full"
  | "bubble_half"
  | "bubble_container";

export function renderHudIconPixels(name: HudIconName): Uint8ClampedArray {
  switch (name) {
    case "heart_full":
      return paintGrid(HEART_GRID, HEART_PALETTE);
    case "heart_container":
      return paintGrid(HEART_GRID, HEART_CONTAINER_PALETTE);
    case "heart_half":
      return halfIcon(paintGrid(HEART_GRID, HEART_PALETTE), paintGrid(HEART_GRID, HEART_CONTAINER_PALETTE));
    case "hunger_full":
      return paintGrid(DRUMSTICK_GRID, DRUMSTICK_PALETTE);
    case "hunger_container":
      return paintGrid(DRUMSTICK_GRID, DRUMSTICK_CONTAINER_PALETTE);
    case "hunger_half":
      return halfIcon(paintGrid(DRUMSTICK_GRID, DRUMSTICK_PALETTE), paintGrid(DRUMSTICK_GRID, DRUMSTICK_CONTAINER_PALETTE));
    case "armor_full":
      return paintGrid(ARMOR_GRID, ARMOR_PALETTE);
    case "armor_container":
      return paintGrid(ARMOR_GRID, ARMOR_CONTAINER_PALETTE);
    case "armor_half":
      return halfIcon(paintGrid(ARMOR_GRID, ARMOR_PALETTE), paintGrid(ARMOR_GRID, ARMOR_CONTAINER_PALETTE));
    case "bubble_full":
      return paintGrid(BUBBLE_GRID, BUBBLE_PALETTE);
    case "bubble_container":
      return paintGrid(BUBBLE_GRID, BUBBLE_CONTAINER_PALETTE);
    case "bubble_half":
      return halfIcon(paintGrid(BUBBLE_GRID, BUBBLE_PALETTE), paintGrid(BUBBLE_GRID, BUBBLE_CONTAINER_PALETTE));
  }
}
