import { describe, expect, test } from "bun:test";
import { createParticlePool, type EmitParticle, PARTICLE_CAP, spawnParticle, updateParticlePool } from "@/lib/game/render/particlePool";

function sample(overrides: Partial<EmitParticle> = {}): EmitParticle {
  return { x: 0, y: 0, z: 0, vx: 1, vy: 2, vz: 0, life: 1, size: 0.1, r: 0.5, g: 0.5, b: 0.5, ...overrides };
}

describe("particlePool", () => {
  test("starts empty with cap-sized buffers", () => {
    const pool = createParticlePool();
    expect(pool.cap).toBe(PARTICLE_CAP);
    expect(pool.count).toBe(0);
    expect(pool.px.length).toBe(PARTICLE_CAP);
    expect(pool.life.length).toBe(PARTICLE_CAP);
  });

  test("spawn fills sequential slots and integrates with gravity + drag", () => {
    const pool = createParticlePool(8);
    spawnParticle(pool, sample({ vx: 1, vy: 0, gravity: 10, drag: 0 }));
    expect(pool.count).toBe(1);

    updateParticlePool(pool, 0.1);
    expect(pool.px[0]).toBeCloseTo(0.1, 5); // moved by vx*dt
    expect(pool.vy[0]).toBeCloseTo(-1, 5); // gravity pulled vy down
    expect(pool.age[0]).toBeCloseTo(0.1, 5);
  });

  test("retires expired particles via swap-removal and keeps the pool packed", () => {
    const pool = createParticlePool(8);
    spawnParticle(pool, sample({ life: 0.05 })); // will expire
    spawnParticle(pool, sample({ life: 10, vx: 0, vy: 0, x: 7 })); // survives
    expect(pool.count).toBe(2);

    updateParticlePool(pool, 0.1);
    expect(pool.count).toBe(1);
    // The survivor was swapped into slot 0.
    expect(pool.px[0]).toBeCloseTo(7, 5);
  });

  test("spawning past cap recycles instead of overflowing", () => {
    const pool = createParticlePool(3);
    for (let i = 0; i < 10; i += 1) spawnParticle(pool, sample({ x: i }));
    expect(pool.count).toBe(3);
    // Last spawn overwrote slot 0 (drop-oldest).
    expect(pool.px[0]).toBe(9);
  });

  test("clamps a huge dt so a stalled tab can't teleport particles", () => {
    const pool = createParticlePool(4);
    spawnParticle(pool, sample({ vx: 1, vy: 0, gravity: 0, drag: 0, life: 100 }));
    updateParticlePool(pool, 999);
    // dt clamped to 0.1 → moved only 0.1, not 999.
    expect(pool.px[0]).toBeCloseTo(0.1, 5);
  });

  test("is deterministic — no internal randomness", () => {
    const a = createParticlePool(4);
    const b = createParticlePool(4);
    const p = sample({ vx: 0.7, vy: 1.3, gravity: 9, drag: 1.2, life: 5 });
    spawnParticle(a, p);
    spawnParticle(b, p);
    for (let i = 0; i < 5; i += 1) {
      updateParticlePool(a, 0.03);
      updateParticlePool(b, 0.03);
    }
    expect(a.px[0]).toBe(b.px[0]);
    expect(a.vy[0]).toBe(b.vy[0]);
  });
});
