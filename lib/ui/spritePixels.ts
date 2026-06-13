import { BLOCK_COLORS, BlockId } from "@/lib/world";
import { ITEM_DEF_BY_ID } from "@/lib/game/items";

/**
 * Procedural 16x16 pixel-art sprites for inventory icons. Pure pixel-buffer
 * code with no DOM or Three.js so it runs under bun test; the canvas/data-URL
 * step lives in sprites.ts. Item shapes are string grids painted through a
 * material palette; block items render as a shaded isometric cube using the
 * same BLOCK_COLORS palette as the world atlas (read-only import).
 */

export const SPRITE_SIZE = 16;

export type Rgb = [number, number, number];
export type PixelPalette = Record<string, Rgb>;

/** Paints a 16-row string grid into RGBA pixels. "." and " " are transparent. */
export function paintGrid(grid: string[], palette: PixelPalette): Uint8ClampedArray {
  const out = new Uint8ClampedArray(SPRITE_SIZE * SPRITE_SIZE * 4);
  for (let y = 0; y < SPRITE_SIZE; y += 1) {
    const row = grid[y] ?? "";
    for (let x = 0; x < SPRITE_SIZE; x += 1) {
      const ch = row[x] ?? ".";
      if (ch === "." || ch === " ") continue;
      const rgb = palette[ch];
      if (!rgb) continue;
      const i = (y * SPRITE_SIZE + x) * 4;
      out[i] = rgb[0];
      out[i + 1] = rgb[1];
      out[i + 2] = rgb[2];
      out[i + 3] = 255;
    }
  }
  return out;
}

// Deterministic per-pixel hash for texture noise (same idea as the atlas).
function pixelHash(x: number, y: number, salt: number): number {
  const v = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453;
  return v - Math.floor(v);
}

const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

// Material color ramps: main, dark, light. Tools and swords combine a shape
// grid with one of these, so 2 shapes cover all 7 material tiers.
export const MATERIAL_PALETTES: Record<string, { m: Rgb; M: Rgb; l: Rgb }> = {
  wood: { m: [158, 110, 57], M: [104, 72, 37], l: [199, 154, 98] },
  stone: { m: [130, 134, 138], M: [84, 88, 92], l: [171, 175, 179] },
  sliver: { m: [200, 205, 214], M: [138, 144, 155], l: [238, 241, 247] },
  ruby: { m: [214, 72, 84], M: [140, 38, 50], l: [243, 134, 144] },
  sapphire: { m: [62, 128, 222], M: [34, 80, 156], l: [130, 180, 245] },
  gold: { m: [240, 190, 60], M: [180, 128, 32], l: [252, 228, 130] },
  diamond: { m: [110, 228, 235], M: [52, 160, 170], l: [190, 248, 250] }
};

const STEEL: { m: Rgb; M: Rgb; l: Rgb } = { m: [192, 197, 207], M: [124, 131, 144], l: [236, 239, 246] };
const HANDLE: { h: Rgb; H: Rgb } = { h: [146, 102, 52], H: [96, 66, 32] };

function toolPalette(material: { m: Rgb; M: Rgb; l: Rgb }): PixelPalette {
  return { m: material.m, M: material.M, l: material.l, h: HANDLE.h, H: HANDLE.H };
}

// --- Shape grids (16x16). Legend: m main, M dark, l light, h/H handle. ---

const PICKAXE_GRID = [
  "...mmmmmmmmmm...",
  "..mlmmmmmmmmlm..",
  ".mlm...mm...mlm.",
  ".mm....mm....mm.",
  ".mm...hHh....mm.",
  ".mm...hHh....mm.",
  ".mM...hHh....Mm.",
  "..M...hHh....M..",
  "......hHh.......",
  "......hHh.......",
  "......hHh.......",
  "......hHh.......",
  "......hHh.......",
  "......hHh.......",
  "......HHH.......",
  "................"
];

const SWORD_GRID = [
  ".......ll.......",
  "......lml.......",
  "......lml.......",
  "......lml.......",
  "......lml.......",
  "......lml.......",
  "......lml.......",
  "......lml.......",
  "......lmM.......",
  "......lmM.......",
  "....MMmmMMM.....",
  "......hHh.......",
  "......hHh.......",
  "......hHh.......",
  ".....HHHH.......",
  "................"
];

// Vertical like the sword so both share one in-hand pose. Reads as a knife:
// shorter, wider single-edged blade — bright cutting edge (l) on the left,
// dark spine (M) on the right, drop-point tip, a dark bolster row, and a
// riveted handle with no crossguard (the sword's signature row).
const KNIFE_GRID = [
  "................",
  "......lM........",
  "......lmM.......",
  "......lmmM......",
  "......lmmM......",
  "......lmmM......",
  "......lmmM......",
  "......lmmM......",
  "......lmmM......",
  "......MMMM......",
  "......hhhh......",
  "......hHhh......",
  "......hhhh......",
  "......hHhh......",
  ".......HH.......",
  "................"
];

const FOOD_GRID = [
  "................",
  "........MMMM....",
  ".......MmmmmM...",
  "......MmmllmmM..",
  "......MmmllmmM..",
  ".....MmmmmmmmM..",
  ".....MmmmmmmM...",
  "....MmmmmmmM....",
  "....MmmmmmM.....",
  ".....MmmMM......",
  ".....bMM........",
  "....bb..........",
  "...bb...........",
  "..wbb...........",
  ".www............",
  "..w............."
];

// --- Material & food item grids (16x16). Legend varies per palette below. ---

const WOOL_GRID = [
  "................",
  "....llllll......",
  "...lmmmmmml.....",
  "..lmmmmmmmml....",
  "..lmmMmmMmml....",
  ".lmmmmmmmmmml...",
  ".lmmMmmmMmmml...",
  ".lmmmmmmmmmml...",
  ".lmmmmMmmmmml...",
  "..lmmmmmmmml....",
  "..lmmMmmmMml....",
  "...lmmmmmml.....",
  "....llllll......",
  "................",
  "................",
  "................"
];

const FEATHER_GRID = [
  "................",
  ".........ww.....",
  "........wwww....",
  ".......wwswl....",
  "......wwsswl....",
  ".....wwsswl.....",
  ".....wssswl.....",
  "....wsssw.l.....",
  "....wssw..l.....",
  "...wssw...l.....",
  "...wsw....l.....",
  "..wsw.....l.....",
  "..sw......l.....",
  ".sw.......l.....",
  ".w........l.....",
  "................"
];

const BONE_GRID = [
  "................",
  "...ll....ll.....",
  "..lwwl..lwwl....",
  "..lwwwllwwwl....",
  "..lwwwwwwwwl....",
  "...lwwwwwwl.....",
  ".....lwwl.......",
  ".....lwwl.......",
  ".....lwwl.......",
  ".....lwwl.......",
  "...lwwwwwwl.....",
  "..lwwwwwwwwl....",
  "..lwwwllwwwl....",
  "..lwwl..lwwl....",
  "...ll....ll.....",
  "................"
];

const LEATHER_GRID = [
  "................",
  "...mmmmmmmm.....",
  "..mMmmmmmmMm....",
  "..mmmmmmmmmm....",
  "..mmMmmmmMmm....",
  "..mmmmmmmmmm....",
  "..mmmmMmmmmm....",
  "..mmMmmmmMmm....",
  "..mmmmmmmmmm....",
  "..mMmmmmmmMm....",
  "...mmmmmmmm.....",
  "................",
  "................",
  "................",
  "................",
  "................"
];

const STRING_GRID = [
  "................",
  "......ssss......",
  ".....s....s.....",
  "....s..ss..s....",
  "...s..s..s..s...",
  "...s.s....s.s...",
  "...s.s....s.s...",
  "...s.s....s.s...",
  "...s..s..s..s...",
  "....s..ss..s....",
  ".....s....s.....",
  "......ssss......",
  "................",
  "................",
  "................",
  "................"
];

// Shared chunk-of-meat shape, recolored per meat (chicken/mutton/rotten).
const RAW_MEAT_GRID = [
  "................",
  ".....mmmm.......",
  "....mMMMMm......",
  "...mMrrrrMm.....",
  "..mMrrrrrrMm....",
  "..mrrrrwrrMm....",
  "..mrrwrrrrMm....",
  "..mrrrrrrrMm....",
  "..mMrrrrrrMm....",
  "...mMrrrrMm.....",
  "....mMMMMm......",
  ".....mmmm.......",
  "................",
  "................",
  "................",
  "................"
];

const HELMET_GRID = [
  "................",
  "................",
  "................",
  ".....mmmmmm.....",
  "...mmllmmmmm....",
  "..mmllmmmmmmm...",
  "..mmlmmmmmmmm...",
  "..mmmmmmmmmmm...",
  "..mmmmmmmmmmm...",
  "..MMMMMMMMMMM...",
  "..mm.......mm...",
  "..MM.......MM...",
  "................",
  "................",
  "................",
  "................"
];

const FACE_MASK_GRID = [
  "................",
  "................",
  "................",
  "...mmmmmmmmmm...",
  "...mllmmmmllm...",
  "...mmmmmmmmmm...",
  "...mm..mm..mm...",
  "...mmmmmmmmmm...",
  "...MmmmmmmmmM...",
  "...MmmM..MmmM...",
  "...MmmmmmmmmM...",
  "....MMMMMMMM....",
  "................",
  "................",
  "................",
  "................"
];

const NECK_GUARD_GRID = [
  "................",
  "................",
  "................",
  "................",
  "...mm......mm...",
  "...mmm....mmm...",
  "...mmmmmmmmmm...",
  "....mmllllmm....",
  "....mmmmmmmm....",
  "....MmmmmmmM....",
  "....MMMMMMMM....",
  "................",
  "................",
  "................",
  "................",
  "................"
];

const CHESTPLATE_GRID = [
  "................",
  "................",
  "..mmm......mmm..",
  "..mmmmmmmmmmmm..",
  "..mmmllmmllmmm..",
  "..mmmmmmmmmmmm..",
  "..MM.mmmmmm.MM..",
  "..MM.mmmmmm.MM..",
  ".....mmmmmm.....",
  ".....mmmmmm.....",
  ".....mmmmmm.....",
  ".....MmmmmM.....",
  ".....MMMMMM.....",
  "................",
  "................",
  "................"
];

const LEGGINGS_GRID = [
  "................",
  "................",
  "...mmmmmmmmmm...",
  "...mllmmmmmmm...",
  "...mmmmmmmmmm...",
  "...mmm....mmm...",
  "...mmm....mmm...",
  "...mmm....mmm...",
  "...mmm....mmm...",
  "...mmm....mmm...",
  "...mmm....mmm...",
  "...MMM....MMM...",
  "................",
  "................",
  "................",
  "................"
];

const BOOTS_GRID = [
  "................",
  "................",
  "................",
  "................",
  "...mm.....mm....",
  "...mm.....mm....",
  "...mm.....mm....",
  "...mm.....mm....",
  "...mmm....mmm...",
  "...mmmm...mmmm..",
  "...MMMM...MMMM..",
  "................",
  "................",
  "................",
  "................",
  "................"
];

const UNKNOWN_GRID = [
  "pppppppPPPPPPPP.",
  "pppppppPPPPPPPP.",
  "pppppppPPPPPPPP.",
  "pppppppPPPPPPPP.",
  "pppppppPPPPPPPP.",
  "pppppppPPPPPPPP.",
  "pppppppPPPPPPPP.",
  "PPPPPPPpppppppp.",
  "PPPPPPPpppppppp.",
  "PPPPPPPpppppppp.",
  "PPPPPPPpppppppp.",
  "PPPPPPPpppppppp.",
  "PPPPPPPpppppppp.",
  "PPPPPPPpppppppp.",
  "PPPPPPPpppppppp.",
  "................"
];

const ARMOR_GRIDS: Record<string, string[]> = {
  helmet: HELMET_GRID,
  face_mask: FACE_MASK_GRID,
  neck_protection: NECK_GUARD_GRID,
  chestplate: CHESTPLATE_GRID,
  leggings: LEGGINGS_GRID,
  boots: BOOTS_GRID
};

const FOOD_PALETTE: PixelPalette = {
  m: [196, 120, 60],
  M: [134, 76, 36],
  l: [232, 168, 104],
  b: [238, 226, 198],
  w: [252, 248, 240]
};

const WOOL_PALETTE: PixelPalette = { m: [236, 236, 236], M: [198, 198, 200], l: [252, 252, 252] };
const FEATHER_PALETTE: PixelPalette = { w: [246, 247, 250], s: [176, 182, 194], l: [255, 255, 255] };
const BONE_PALETTE: PixelPalette = { w: [236, 233, 220], l: [198, 194, 178] };
const LEATHER_PALETTE: PixelPalette = { m: [150, 95, 55], M: [98, 60, 33] };
const STRING_PALETTE: PixelPalette = { s: [224, 221, 208] };
const RAW_CHICKEN_PALETTE: PixelPalette = { m: [236, 200, 182], M: [198, 150, 132], r: [242, 184, 174], w: [250, 232, 218] };
const RAW_MUTTON_PALETTE: PixelPalette = { m: [186, 96, 86], M: [132, 56, 50], r: [202, 84, 84], w: [226, 182, 172] };
const ROTTEN_FLESH_PALETTE: PixelPalette = { m: [122, 132, 82], M: [80, 90, 54], r: [110, 122, 76], w: [152, 152, 112] };

/**
 * Pixel grids for non-block, non-gear items (materials, food). Keyed by item id
 * so adding an item only needs an entry here plus its ITEM_DEFS row. The render
 * function consults this before the kind-based fallbacks.
 */
const ITEM_SPRITE_GRIDS: Record<string, { grid: string[]; palette: PixelPalette }> = {
  food: { grid: FOOD_GRID, palette: FOOD_PALETTE },
  wool: { grid: WOOL_GRID, palette: WOOL_PALETTE },
  feather: { grid: FEATHER_GRID, palette: FEATHER_PALETTE },
  bone: { grid: BONE_GRID, palette: BONE_PALETTE },
  leather: { grid: LEATHER_GRID, palette: LEATHER_PALETTE },
  string: { grid: STRING_GRID, palette: STRING_PALETTE },
  raw_chicken: { grid: RAW_MEAT_GRID, palette: RAW_CHICKEN_PALETTE },
  raw_mutton: { grid: RAW_MEAT_GRID, palette: RAW_MUTTON_PALETTE },
  rotten_flesh: { grid: RAW_MEAT_GRID, palette: ROTTEN_FLESH_PALETTE }
};

// Ore accent colors sprinkled over the stone cube (mirrors the atlas sparkle).
const ORE_ACCENTS: Partial<Record<BlockId, Rgb>> = {
  [BlockId.SliverOre]: [222, 226, 233],
  [BlockId.RubyOre]: [220, 68, 84],
  [BlockId.GoldOre]: [244, 196, 72],
  [BlockId.SapphireOre]: [70, 140, 230],
  [BlockId.DiamondOre]: [140, 235, 244]
};

function blockRgb(blockId: BlockId): Rgb {
  const float = BLOCK_COLORS[blockId] ?? [0.6, 0.6, 0.6];
  return [float[0] * 255, float[1] * 255, float[2] * 255];
}

/**
 * Shaded isometric cube for a block item: bright top diamond, mid left face,
 * dark right face, with per-pixel noise. Grass gets dirt sides with a grass
 * lip; ores get accent speckles.
 */
export function paintIsoBlock(blockId: BlockId): Uint8ClampedArray {
  const out = new Uint8ClampedArray(SPRITE_SIZE * SPRITE_SIZE * 4);
  const accent = ORE_ACCENTS[blockId];
  const topColor = blockRgb(blockId);
  const sideColor = blockId === BlockId.Grass ? blockRgb(BlockId.Dirt) : topColor;

  for (let x = 0; x < SPRITE_SIZE; x += 1) {
    const px = x + 0.5;
    const onLeft = px <= 8;
    // Distance 0..1 from the outer vertex toward the center column.
    const dx = onLeft ? (px - 0.5) / 7.5 : (15.5 - px) / 7.5;
    const topY = 4 - dx * 3.5; // edge from a side vertex up to the top vertex
    const midY = 4 + dx * 3.5; // edge from a side vertex down to the bottom of the top face
    const botY = midY + 8;

    for (let y = 0; y < SPRITE_SIZE; y += 1) {
      const py = y + 0.5;
      if (py < topY || py >= botY) continue;
      const onTop = py < midY;

      let rgb: Rgb;
      let shade: number;
      if (onTop) {
        rgb = topColor;
        shade = 1.18;
      } else if (blockId === BlockId.Grass && py < midY + 1.6) {
        rgb = topColor; // grass lip at the top of the side faces
        shade = onLeft ? 0.86 : 0.62;
      } else {
        rgb = sideColor;
        shade = onLeft ? 0.82 : 0.56;
      }

      const noise = 0.92 + pixelHash(x, y, blockId) * 0.16;
      if (accent && !onTop && pixelHash(x * 3 + 1, y * 3 + 2, blockId) > 0.82) {
        rgb = accent;
      }
      const i = (y * SPRITE_SIZE + x) * 4;
      out[i] = clampByte(rgb[0] * shade * noise);
      out[i + 1] = clampByte(rgb[1] * shade * noise);
      out[i + 2] = clampByte(rgb[2] * shade * noise);
      out[i + 3] = 255;
    }
  }
  return out;
}

function materialFor(itemId: string): { m: Rgb; M: Rgb; l: Rgb } {
  const prefix = itemId.split("_")[0];
  return MATERIAL_PALETTES[prefix] ?? STEEL;
}

/** 16x16 RGBA pixels for any item id; magenta checker for unknown ids. */
export function renderSpritePixels(itemId: string): Uint8ClampedArray {
  const def = ITEM_DEF_BY_ID[itemId];
  const custom = ITEM_SPRITE_GRIDS[itemId];
  if (custom) return paintGrid(custom.grid, custom.palette);
  if (def?.kind === "block" && def.blockId !== undefined) return paintIsoBlock(def.blockId);
  if (def?.kind === "tool") return paintGrid(PICKAXE_GRID, toolPalette(materialFor(itemId)));
  if (def?.kind === "weapon") {
    if (itemId === "knife") return paintGrid(KNIFE_GRID, toolPalette(STEEL));
    return paintGrid(SWORD_GRID, toolPalette(materialFor(itemId)));
  }
  if (def?.kind === "armor" && def.armorSlot) {
    return paintGrid(ARMOR_GRIDS[def.armorSlot] ?? UNKNOWN_GRID, { m: STEEL.m, M: STEEL.M, l: STEEL.l });
  }
  return paintGrid(UNKNOWN_GRID, { p: [240, 40, 240], P: [40, 8, 40] });
}
