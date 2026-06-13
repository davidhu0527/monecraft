import * as THREE from "three";
import { sunAngleAt } from "@/lib/game/engine/systems/dayNight";
import type { GameState } from "@/lib/game/engine/state";
import { generateStarPositions } from "./starField";

/**
 * Atmospheric sky dressing layered over the existing day-night sky-color lerp:
 * a star field that fades in at dusk, a moon and sun disc that ride opposite
 * ends of the sun arc, and a drifting cloud sheet. Everything follows the
 * camera and ignores fog so it reads as distant sky. All visuals are
 * procedural (Points + canvas-noise textures) — no image assets.
 */

const SKY_RADIUS = 900;
const CLOUD_HEIGHT = 140;
const STAR_SEED = 1337;

export type SkyView = {
  sync(state: GameState, timeMs: number): void;
  dispose(): void;
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function skyDir(angle: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(Math.cos(angle), Math.sin(angle), Math.sin(angle * 0.7) * 0.6).normalize();
}

/** Soft radial disc (white core → transparent edge) for the sun/moon sprites. */
function discTexture(core: string): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
    g.addColorStop(0, core);
    g.addColorStop(0.55, core);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

/** Low-frequency, seamlessly tiling cloud alpha mask (white puffs on clear). */
function cloudTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const image = ctx.createImageData(size, size);
    const wave = (k: number, t: number) => Math.sin(((2 * Math.PI * k) / size) * t);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const v = wave(3, x) + wave(2, y) + wave(2, x + y) + wave(1, x - y);
        const n = v / 4; // -1..1
        const alpha = clamp01((n - 0.15) * 1.8);
        const i = (y * size + x) * 4;
        image.data[i] = 255;
        image.data[i + 1] = 255;
        image.data[i + 2] = 255;
        image.data[i + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(image, 0, 0);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  return texture;
}

export function createSkyView(scene: THREE.Scene, camera: THREE.PerspectiveCamera): SkyView {
  // Stars.
  const starGeo = new THREE.BufferGeometry();
  const positions = generateStarPositions(800, STAR_SEED).map((v) => v * SKY_RADIUS);
  starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.4, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.raycast = () => {};
  scene.add(stars);

  // Sun + moon discs.
  const sunTex = discTexture("rgba(255,247,214,1)");
  const moonTex = discTexture("rgba(226,232,245,1)");
  const sunMat = new THREE.SpriteMaterial({ map: sunTex, transparent: true, depthWrite: false, fog: false });
  const moonMat = new THREE.SpriteMaterial({ map: moonTex, transparent: true, depthWrite: false, fog: false });
  const sun = new THREE.Sprite(sunMat);
  const moon = new THREE.Sprite(moonMat);
  sun.scale.setScalar(95);
  moon.scale.setScalar(70);
  scene.add(sun);
  scene.add(moon);

  // Clouds.
  const cloudTex = cloudTexture();
  const cloudGeo = new THREE.PlaneGeometry(1400, 1400);
  const cloudMat = new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: 0.32, depthWrite: false, fog: false });
  const clouds = new THREE.Mesh(cloudGeo, cloudMat);
  clouds.rotation.x = -Math.PI / 2;
  clouds.frustumCulled = false;
  clouds.raycast = () => {};
  scene.add(clouds);

  const dir = new THREE.Vector3();
  let lastMs = Number.NaN;

  return {
    sync(state, timeMs) {
      const dtMs = Number.isNaN(lastMs) ? 16 : Math.max(0, timeMs - lastMs);
      lastMs = timeMs;
      const { daylight } = state;
      const cam = camera.position;
      const sunAngle = sunAngleAt(state.dayClock);

      stars.position.copy(cam);
      starMat.opacity = clamp01(1 - daylight * 2.2);

      skyDir(sunAngle, dir);
      sun.position.copy(cam).addScaledVector(dir, SKY_RADIUS);
      sunMat.opacity = clamp01(daylight * 1.4 - 0.08);

      skyDir(sunAngle + Math.PI, dir);
      moon.position.copy(cam).addScaledVector(dir, SKY_RADIUS);
      moonMat.opacity = clamp01(0.9 - daylight * 1.8);

      clouds.position.set(cam.x, cam.y + CLOUD_HEIGHT, cam.z);
      cloudMat.opacity = 0.12 + daylight * 0.24;
      cloudTex.offset.x += dtMs * 0.000004;
      cloudTex.offset.y += dtMs * 0.0000022;
    },

    dispose() {
      scene.remove(stars);
      scene.remove(sun);
      scene.remove(moon);
      scene.remove(clouds);
      starGeo.dispose();
      starMat.dispose();
      sunMat.dispose();
      moonMat.dispose();
      sunTex.dispose();
      moonTex.dispose();
      cloudGeo.dispose();
      cloudMat.dispose();
      cloudTex.dispose();
    }
  };
}
