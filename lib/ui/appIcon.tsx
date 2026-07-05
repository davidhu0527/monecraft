import { BLOCK_COLORS, BlockId } from "@/lib/world";

/**
 * The app icon as pixel art: an 8x8 grass-block face (green cap over dirt)
 * painted from the same BLOCK_COLORS palette as the world atlas. Rendered as
 * nested flex rows of colored divs because Satori (next/og ImageResponse)
 * supports flexbox but not canvas or CSS grid.
 */

const ICON_GRID = 8;
/** Rows fully covered by grass; one more row below is jagged. */
const GRASS_ROWS = 2;

type Rgb = [number, number, number];

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function tone(c: Rgb, mul: number): Rgb {
  return [clamp01(c[0] * mul), clamp01(c[1] * mul), clamp01(c[2] * mul)];
}

function css(c: Rgb): string {
  return `rgb(${Math.floor(c[0] * 255)}, ${Math.floor(c[1] * 255)}, ${Math.floor(c[2] * 255)})`;
}

// Deterministic per-pixel hash for texture noise (same idea as the atlas).
function pixelHash(x: number, y: number): number {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function cellColor(x: number, y: number): string {
  const grass = y < GRASS_ROWS || (y === GRASS_ROWS && pixelHash(x, 97) > 0.45);
  const base = grass ? BLOCK_COLORS[BlockId.Grass] : BLOCK_COLORS[BlockId.Dirt];
  return css(tone(base, (grass ? 0.95 : 0.88) + pixelHash(x, y) * 0.22));
}

const CELLS = Array.from({ length: ICON_GRID }, (_, i) => i);

/**
 * Fills its container; `scale` shrinks the art inside it (maskable icons need
 * the art within the ~80% safe zone on a full-bleed background).
 */
export function AppIcon({ scale = 1, background = "transparent" }: { scale?: number; background?: string }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: background
      }}
    >
      <div style={{ width: `${scale * 100}%`, height: `${scale * 100}%`, display: "flex", flexDirection: "column" }}>
        {CELLS.map((y) => (
          <div key={y} style={{ display: "flex", flex: 1 }}>
            {CELLS.map((x) => (
              <div key={x} style={{ flex: 1, backgroundColor: cellColor(x, y) }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
