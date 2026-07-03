/**
 * Entity interpolation: remote players and mobs render ~125 ms in the past,
 * lerped between the two authoritative samples that bracket the target time.
 * Pure math over per-entity ring buffers — no engine, no sockets.
 */

export const INTERPOLATION_DELAY_MS = 125;
const BUFFER_SIZE = 32; // ~1.6s of 20 Hz samples

export type PoseSample = { tMs: number; x: number; y: number; z: number; yaw: number; pitch?: number };
export type InterpolatedPose = { x: number; y: number; z: number; yaw: number; pitch: number };

/** Shortest-path angular lerp (yaw wraps at ±π). */
export function lerpAngle(a: number, b: number, t: number): number {
  const TWO_PI = Math.PI * 2;
  let delta = (b - a) % TWO_PI;
  if (delta > Math.PI) delta -= TWO_PI;
  if (delta < -Math.PI) delta += TWO_PI;
  return a + delta * t;
}

export type PoseBuffer = {
  push(sample: PoseSample): void;
  /** The pose at `renderTimeMs` (already delay-adjusted by the caller), or null before two samples exist. */
  sample(renderTimeMs: number): InterpolatedPose | null;
  /** Latest raw sample (for spawn placement / distance checks). */
  latest(): PoseSample | null;
};

export function createPoseBuffer(): PoseBuffer {
  const samples: PoseSample[] = [];

  return {
    push(sample) {
      // The buffer is a monotonic timeline: a duplicate timestamp refreshes
      // the sample, a strictly older late arrival is stale news — dropped.
      const last = samples[samples.length - 1];
      if (last && sample.tMs <= last.tMs) {
        if (sample.tMs === last.tMs) samples[samples.length - 1] = sample;
        return;
      }
      samples.push(sample);
      if (samples.length > BUFFER_SIZE) samples.shift();
    },

    sample(renderTimeMs) {
      if (samples.length === 0) return null;
      const first = samples[0];
      const last = samples[samples.length - 1];
      // Behind the buffer: clamp to the oldest we know.
      if (renderTimeMs <= first.tMs) return { x: first.x, y: first.y, z: first.z, yaw: first.yaw, pitch: first.pitch ?? 0 };
      // Ahead of the buffer (stalled stream): clamp to the newest — never extrapolate.
      if (renderTimeMs >= last.tMs) return { x: last.x, y: last.y, z: last.z, yaw: last.yaw, pitch: last.pitch ?? 0 };
      let after = 1;
      while (samples[after].tMs < renderTimeMs) after += 1;
      const b = samples[after];
      const a = samples[after - 1];
      const t = (renderTimeMs - a.tMs) / Math.max(1e-6, b.tMs - a.tMs);
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
        yaw: lerpAngle(a.yaw, b.yaw, t),
        pitch: lerpAngle(a.pitch ?? 0, b.pitch ?? 0, t)
      };
    },

    latest() {
      return samples[samples.length - 1] ?? null;
    }
  };
}
