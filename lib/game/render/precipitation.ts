import * as THREE from "three";
import type { GameState } from "@/lib/game/engine/state";

/**
 * Camera-following rain/snow field driven by state.weather. A fixed pool of
 * points falls through a box around the camera; particles that drop below or
 * drift out of the box are recycled at the top, so the field never depletes and
 * always surrounds the player. Rain falls fast and bluish; snow drifts slowly
 * and white. Procedural soft-dot sprite — no asset. Hidden when weather is clear.
 */

const MAX_PRECIP = 320;
const BOX_HALF = 20;
const SPAWN_TOP = 16;
const FLOOR_BELOW = 8;

const RAIN_COLOR = new THREE.Color(0.62, 0.68, 0.82);
const SNOW_COLOR = new THREE.Color(0.95, 0.96, 1);

function dotTexture(): THREE.CanvasTexture {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0.5, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.5, "rgba(255,255,255,0.85)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

export type PrecipitationView = {
  sync(state: GameState, dtMs: number, cameraPos: THREE.Vector3): void;
  dispose(): void;
};

export function createPrecipitation(scene: THREE.Scene): PrecipitationView {
  const px = new Float32Array(MAX_PRECIP);
  const py = new Float32Array(MAX_PRECIP);
  const pz = new Float32Array(MAX_PRECIP);
  const vx = new Float32Array(MAX_PRECIP);
  const vy = new Float32Array(MAX_PRECIP);
  const vz = new Float32Array(MAX_PRECIP);
  let seeded = false;

  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(new Float32Array(MAX_PRECIP * 3), 3);
  position.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", position);
  geometry.setDrawRange(0, 0);

  const texture = dotTexture();
  const material = new THREE.PointsMaterial({ map: texture, color: RAIN_COLOR, size: 0.2, transparent: true, depthWrite: false, sizeAttenuation: true });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.raycast = () => {};
  scene.add(points);

  const reseed = (i: number, cam: THREE.Vector3): void => {
    px[i] = cam.x + (Math.random() * 2 - 1) * BOX_HALF;
    pz[i] = cam.z + (Math.random() * 2 - 1) * BOX_HALF;
    py[i] = cam.y + 2 + Math.random() * SPAWN_TOP;
  };

  return {
    sync(state, dtMs, cam) {
      const { kind, intensity } = state.weather;
      if (kind === "clear" || intensity <= 0) {
        geometry.setDrawRange(0, 0);
        return;
      }
      const dt = Math.min(dtMs / 1000, 0.1);
      const snow = kind === "snow";
      const target = Math.floor(intensity * MAX_PRECIP);
      const fall = snow ? 3.2 : 22;
      const wind = snow ? 1.2 : 2.5;

      material.color.copy(snow ? SNOW_COLOR : RAIN_COLOR);
      material.size = snow ? 0.32 : 0.18;
      material.opacity = 0.5 + intensity * 0.45;

      if (!seeded) {
        for (let i = 0; i < MAX_PRECIP; i += 1) {
          reseed(i, cam);
          vx[i] = (Math.random() * 2 - 1) * wind;
          vy[i] = -fall * (0.85 + Math.random() * 0.3);
          vz[i] = (Math.random() * 2 - 1) * wind;
        }
        seeded = true;
      }

      const arr = position.array as Float32Array;
      for (let i = 0; i < target; i += 1) {
        px[i] += vx[i] * dt;
        py[i] += (snow ? vy[i] : -fall) * dt;
        pz[i] += vz[i] * dt;
        if (py[i] < cam.y - FLOOR_BELOW || Math.abs(px[i] - cam.x) > BOX_HALF + 6 || Math.abs(pz[i] - cam.z) > BOX_HALF + 6) {
          reseed(i, cam);
          vx[i] = (Math.random() * 2 - 1) * wind;
          vy[i] = -fall * (0.85 + Math.random() * 0.3);
          vz[i] = (Math.random() * 2 - 1) * wind;
        }
        arr[i * 3] = px[i];
        arr[i * 3 + 1] = py[i];
        arr[i * 3 + 2] = pz[i];
      }
      geometry.setDrawRange(0, target);
      position.needsUpdate = true;
    },

    dispose() {
      scene.remove(points);
      geometry.dispose();
      material.dispose();
      texture.dispose();
    }
  };
}
