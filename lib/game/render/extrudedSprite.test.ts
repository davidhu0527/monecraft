import { describe, expect, test } from "bun:test";
import { buildExtrudedSpriteGeometry } from "@/lib/game/render/extrudedSprite";

const SIZE = 4;

function makePixels(opaque: [number, number, [number, number, number]?][]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (const [x, y, rgb] of opaque) {
    const i = (y * SIZE + x) * 4;
    out[i] = rgb?.[0] ?? 255;
    out[i + 1] = rgb?.[1] ?? 0;
    out[i + 2] = rgb?.[2] ?? 0;
    out[i + 3] = 255;
  }
  return out;
}

function quadCount(geometry: ReturnType<typeof buildExtrudedSpriteGeometry>): number {
  return geometry.getAttribute("position").count / 6; // 6 vertices per quad
}

describe("buildExtrudedSpriteGeometry", () => {
  test("a single pixel becomes a full box (6 faces)", () => {
    const geometry = buildExtrudedSpriteGeometry(makePixels([[1, 1]]), SIZE);
    expect(quadCount(geometry)).toBe(6);
  });

  test("adjacent pixels cull their shared side faces", () => {
    // Two pixels side by side: 2 fronts + 2 backs + 2 tops + 2 bottoms + 1 left + 1 right.
    const geometry = buildExtrudedSpriteGeometry(
      makePixels([
        [1, 1],
        [2, 1]
      ]),
      SIZE
    );
    expect(quadCount(geometry)).toBe(10);
  });

  test("fully transparent input produces an empty geometry", () => {
    const geometry = buildExtrudedSpriteGeometry(new Uint8ClampedArray(SIZE * SIZE * 4), SIZE);
    expect(geometry.getAttribute("position").count).toBe(0);
  });

  test("vertex colors come from the source pixel with baked face shading", () => {
    const geometry = buildExtrudedSpriteGeometry(makePixels([[0, 0, [255, 128, 0]]]), SIZE);
    const colors = geometry.getAttribute("color");
    // First quad emitted is the front face (shade 1.0).
    expect(colors.getX(0)).toBeCloseTo(1.0);
    expect(colors.getY(0)).toBeCloseTo(128 / 255);
    expect(colors.getZ(0)).toBeCloseTo(0);
    // Side faces are darker than the front: some color channel below full red.
    let darker = 0;
    for (let i = 0; i < colors.count; i += 1) {
      if (colors.getX(i) < 0.99) darker += 1;
    }
    expect(darker).toBeGreaterThan(0);
  });

  test("geometry is centered on the grid and pixel-thick", () => {
    const pixelSize = 0.03;
    const geometry = buildExtrudedSpriteGeometry(makePixels([[0, 0]]), SIZE, pixelSize, pixelSize);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const half = (SIZE * pixelSize) / 2;
    // Pixel (0,0) is the top-left corner of the centered grid.
    expect(box.min.x).toBeCloseTo(-half);
    expect(box.max.y).toBeCloseTo(half);
    expect(box.max.z - box.min.z).toBeCloseTo(pixelSize);
  });

  test("is deterministic for the same input", () => {
    const pixels = makePixels([
      [1, 1],
      [2, 2]
    ]);
    const a = buildExtrudedSpriteGeometry(pixels, SIZE).getAttribute("position");
    const b = buildExtrudedSpriteGeometry(pixels, SIZE).getAttribute("position");
    expect(Array.from(a.array)).toEqual(Array.from(b.array));
  });
});
