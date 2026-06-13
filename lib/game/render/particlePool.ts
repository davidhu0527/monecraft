/**
 * A pure, DOM-free particle simulation: a fixed structure-of-arrays pool that
 * the THREE wiring (particleSystem.ts) uploads to GPU buffers each frame.
 * Kept free of Three.js and of randomness (callers supply jitter) so it runs
 * and is unit-tested under `bun test`.
 */

export const PARTICLE_CAP = 512;

export type ParticlePool = {
  readonly cap: number;
  /** Live particles occupy slots [0, count); update() keeps them front-packed. */
  count: number;
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  age: Float32Array;
  life: Float32Array;
  size: Float32Array;
  cr: Float32Array;
  cg: Float32Array;
  cb: Float32Array;
  gravity: Float32Array;
  drag: Float32Array;
};

export type EmitParticle = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size: number;
  r: number;
  g: number;
  b: number;
  gravity?: number;
  drag?: number;
};

export function createParticlePool(cap: number = PARTICLE_CAP): ParticlePool {
  return {
    cap,
    count: 0,
    px: new Float32Array(cap),
    py: new Float32Array(cap),
    pz: new Float32Array(cap),
    vx: new Float32Array(cap),
    vy: new Float32Array(cap),
    vz: new Float32Array(cap),
    age: new Float32Array(cap),
    life: new Float32Array(cap),
    size: new Float32Array(cap),
    cr: new Float32Array(cap),
    cg: new Float32Array(cap),
    cb: new Float32Array(cap),
    gravity: new Float32Array(cap),
    drag: new Float32Array(cap)
  };
}

function writeSlot(pool: ParticlePool, i: number, p: EmitParticle): void {
  pool.px[i] = p.x;
  pool.py[i] = p.y;
  pool.pz[i] = p.z;
  pool.vx[i] = p.vx;
  pool.vy[i] = p.vy;
  pool.vz[i] = p.vz;
  pool.age[i] = 0;
  pool.life[i] = p.life;
  pool.size[i] = p.size;
  pool.cr[i] = p.r;
  pool.cg[i] = p.g;
  pool.cb[i] = p.b;
  pool.gravity[i] = p.gravity ?? 0;
  pool.drag[i] = p.drag ?? 0;
}

function copySlot(pool: ParticlePool, from: number, to: number): void {
  pool.px[to] = pool.px[from];
  pool.py[to] = pool.py[from];
  pool.pz[to] = pool.pz[from];
  pool.vx[to] = pool.vx[from];
  pool.vy[to] = pool.vy[from];
  pool.vz[to] = pool.vz[from];
  pool.age[to] = pool.age[from];
  pool.life[to] = pool.life[from];
  pool.size[to] = pool.size[from];
  pool.cr[to] = pool.cr[from];
  pool.cg[to] = pool.cg[from];
  pool.cb[to] = pool.cb[from];
  pool.gravity[to] = pool.gravity[from];
  pool.drag[to] = pool.drag[from];
}

/** Adds one particle. At capacity it recycles slot 0 (drop-oldest) — cosmetic
 *  bursts don't care about exact ordering, and this never overflows. */
export function spawnParticle(pool: ParticlePool, p: EmitParticle): void {
  if (pool.count < pool.cap) {
    writeSlot(pool, pool.count, p);
    pool.count += 1;
  } else {
    writeSlot(pool, 0, p);
  }
}

/** Integrates `dt` seconds: ages particles, applies gravity + drag, and retires
 *  expired ones by swap-removal so live particles stay packed in [0, count).
 *  `dt` is clamped so a stalled/backgrounded tab can't teleport everything. */
export function updateParticlePool(pool: ParticlePool, dt: number): void {
  const d = Math.max(0, Math.min(dt, 0.1));
  let i = 0;
  while (i < pool.count) {
    pool.age[i] += d;
    if (pool.age[i] >= pool.life[i]) {
      const last = pool.count - 1;
      if (i !== last) copySlot(pool, last, i);
      pool.count = last;
      continue; // re-process the slot that was swapped in
    }
    const dragF = Math.max(0, 1 - pool.drag[i] * d);
    pool.vy[i] -= pool.gravity[i] * d;
    pool.vx[i] *= dragF;
    pool.vy[i] *= dragF;
    pool.vz[i] *= dragF;
    pool.px[i] += pool.vx[i] * d;
    pool.py[i] += pool.vy[i] * d;
    pool.pz[i] += pool.vz[i] * d;
    i += 1;
  }
}
