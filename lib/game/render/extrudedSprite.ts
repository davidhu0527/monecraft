import * as THREE from "three";

/**
 * Extrudes a 16x16 RGBA sprite (from renderSpritePixels) into a thin voxel
 * mesh: every opaque pixel becomes a pixel-thick box, merged into one
 * triangle-soup geometry with vertex colors (same style as world meshing).
 * Front/back faces always render; side faces only where the neighbouring
 * pixel is transparent, so the silhouette outline is the only side geometry.
 */

// Per-axis brightness baked into vertex colors so the flat model reads as 3D.
const SHADE_FRONT_BACK = 1.0;
const SHADE_TOP_BOTTOM = 0.85;
const SHADE_LEFT_RIGHT = 0.7;

export function buildExtrudedSpriteGeometry(pixels: Uint8ClampedArray, size = 16, pixelSize = 0.03, depth = 0.03): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];

  const opaque = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= size || y >= size) return false;
    return pixels[(y * size + x) * 4 + 3] > 0;
  };

  const half = (size * pixelSize) / 2;
  const halfDepth = depth / 2;

  // Quad corners wind counter-clockwise as seen from outside (along +normal).
  const pushQuad = (corners: [number, number, number][], normal: [number, number, number], rgb: [number, number, number], shade: number) => {
    const order = [0, 1, 2, 0, 2, 3];
    for (const i of order) {
      positions.push(corners[i][0], corners[i][1], corners[i][2]);
      normals.push(normal[0], normal[1], normal[2]);
      colors.push((rgb[0] / 255) * shade, (rgb[1] / 255) * shade, (rgb[2] / 255) * shade);
    }
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!opaque(x, y)) continue;
      const i = (y * size + x) * 4;
      const rgb: [number, number, number] = [pixels[i], pixels[i + 1], pixels[i + 2]];

      // Grid row 0 is the top of the sprite; geometry is centered at the origin.
      const x0 = x * pixelSize - half;
      const x1 = x0 + pixelSize;
      const y1 = half - y * pixelSize;
      const y0 = y1 - pixelSize;
      const z0 = -halfDepth;
      const z1 = halfDepth;

      pushQuad(
        [
          [x0, y0, z1],
          [x1, y0, z1],
          [x1, y1, z1],
          [x0, y1, z1]
        ],
        [0, 0, 1],
        rgb,
        SHADE_FRONT_BACK
      );
      pushQuad(
        [
          [x1, y0, z0],
          [x0, y0, z0],
          [x0, y1, z0],
          [x1, y1, z0]
        ],
        [0, 0, -1],
        rgb,
        SHADE_FRONT_BACK
      );
      if (!opaque(x, y - 1)) {
        pushQuad(
          [
            [x0, y1, z1],
            [x1, y1, z1],
            [x1, y1, z0],
            [x0, y1, z0]
          ],
          [0, 1, 0],
          rgb,
          SHADE_TOP_BOTTOM
        );
      }
      if (!opaque(x, y + 1)) {
        pushQuad(
          [
            [x0, y0, z0],
            [x1, y0, z0],
            [x1, y0, z1],
            [x0, y0, z1]
          ],
          [0, -1, 0],
          rgb,
          SHADE_TOP_BOTTOM
        );
      }
      if (!opaque(x - 1, y)) {
        pushQuad(
          [
            [x0, y0, z0],
            [x0, y0, z1],
            [x0, y1, z1],
            [x0, y1, z0]
          ],
          [-1, 0, 0],
          rgb,
          SHADE_LEFT_RIGHT
        );
      }
      if (!opaque(x + 1, y)) {
        pushQuad(
          [
            [x1, y0, z1],
            [x1, y0, z0],
            [x1, y1, z0],
            [x1, y1, z1]
          ],
          [1, 0, 0],
          rgb,
          SHADE_LEFT_RIGHT
        );
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}
