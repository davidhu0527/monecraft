import * as THREE from "three";
import { createParticlePool, spawnParticle, updateParticlePool } from "./particlePool";

/**
 * GPU wrapper around the pure particlePool: one THREE.Points draw call whose
 * position/color/size/alpha attributes are refilled from the pool each frame.
 * A small ShaderMaterial draws each particle as a soft round sprite that fades
 * out over its life — no texture, so it stays a zero-asset effect. emitBurst()
 * is the only place randomness enters, keeping the pool itself deterministic.
 */

export type BurstOptions = {
  x: number;
  y: number;
  z: number;
  count: number;
  color: [number, number, number];
  speed: number;
  spread?: number;
  life?: [number, number];
  size?: number;
  gravity?: number;
  drag?: number;
  upBias?: number;
  colorJitter?: number;
};

export type ParticleSystem = {
  emitBurst(opts: BurstOptions): void;
  update(dtMs: number): void;
  dispose(): void;
};

export function hexToRgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

const VERTEX_SHADER = /* glsl */ `
  attribute vec3 acolor;
  attribute float psize;
  attribute float palpha;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uScale;
  void main() {
    vColor = acolor;
    vAlpha = palpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(1.0, psize * uScale / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = dot(d, d);
    if (r > 0.25) discard;
    float edge = smoothstep(0.25, 0.04, r);
    gl_FragColor = vec4(vColor, vAlpha * edge);
  }
`;

export function createParticleSystem(scene: THREE.Scene): ParticleSystem {
  const pool = createParticlePool();
  const cap = pool.cap;

  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(new Float32Array(cap * 3), 3);
  const acolor = new THREE.BufferAttribute(new Float32Array(cap * 3), 3);
  const psize = new THREE.BufferAttribute(new Float32Array(cap), 1);
  const palpha = new THREE.BufferAttribute(new Float32Array(cap), 1);
  position.setUsage(THREE.DynamicDrawUsage);
  acolor.setUsage(THREE.DynamicDrawUsage);
  psize.setUsage(THREE.DynamicDrawUsage);
  palpha.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", position);
  geometry.setAttribute("acolor", acolor);
  geometry.setAttribute("psize", psize);
  geometry.setAttribute("palpha", palpha);
  geometry.setDrawRange(0, 0);

  const material = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 620 } },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.raycast = () => {};
  points.renderOrder = 4;
  scene.add(points);

  return {
    emitBurst(opts) {
      const spread = opts.spread ?? 1;
      const [lifeMin, lifeMax] = opts.life ?? [0.3, 0.6];
      const size = opts.size ?? 0.14;
      const jitter = opts.colorJitter ?? 0;
      const upBias = opts.upBias ?? 0;
      for (let n = 0; n < opts.count; n += 1) {
        // Random direction on a sphere, scaled by speed + per-particle spread.
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const sp = opts.speed * (0.5 + Math.random());
        spawnParticle(pool, {
          x: opts.x,
          y: opts.y,
          z: opts.z,
          vx: Math.sin(phi) * Math.cos(theta) * sp + (Math.random() - 0.5) * spread,
          vy: Math.cos(phi) * sp + (Math.random() - 0.5) * spread + upBias,
          vz: Math.sin(phi) * Math.sin(theta) * sp + (Math.random() - 0.5) * spread,
          life: lifeMin + Math.random() * (lifeMax - lifeMin),
          size: size * (0.7 + Math.random() * 0.6),
          r: clamp01(opts.color[0] + (Math.random() - 0.5) * jitter),
          g: clamp01(opts.color[1] + (Math.random() - 0.5) * jitter),
          b: clamp01(opts.color[2] + (Math.random() - 0.5) * jitter),
          gravity: opts.gravity ?? 0,
          drag: opts.drag ?? 0
        });
      }
    },

    update(dtMs) {
      updateParticlePool(pool, dtMs / 1000);
      const n = pool.count;
      const pos = position.array as Float32Array;
      const col = acolor.array as Float32Array;
      const sz = psize.array as Float32Array;
      const al = palpha.array as Float32Array;
      for (let i = 0; i < n; i += 1) {
        pos[i * 3] = pool.px[i];
        pos[i * 3 + 1] = pool.py[i];
        pos[i * 3 + 2] = pool.pz[i];
        col[i * 3] = pool.cr[i];
        col[i * 3 + 1] = pool.cg[i];
        col[i * 3 + 2] = pool.cb[i];
        sz[i] = pool.size[i];
        // Fade out over the back half of life.
        const t = pool.age[i] / pool.life[i];
        al[i] = t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) * 2);
      }
      geometry.setDrawRange(0, n);
      if (n > 0) {
        position.needsUpdate = true;
        acolor.needsUpdate = true;
        psize.needsUpdate = true;
        palpha.needsUpdate = true;
      }
    },

    dispose() {
      scene.remove(points);
      geometry.dispose();
      material.dispose();
    }
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
