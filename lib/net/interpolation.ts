/**
 * Entity interpolation: remote players and mobs render in the past, lerped
 * between the two authoritative samples that bracket the target time. How FAR
 * in the past is adaptive: a fixed delay sized for LAN jitter underruns on a
 * jittery long-haul link — ticks arrive in bursts, the buffer runs dry, and
 * remote entities freeze-and-snap. The DelayController measures tick
 * inter-arrival jitter and sizes the delay to absorb it, slewing gradually so
 * remote timelines never visibly warp. Pure math over per-entity ring
 * buffers — no engine, no sockets.
 */

/** The floor (the old fixed delay) — what clean links converge to. */
export const INTERPOLATION_DELAY_MIN_MS = 125;
export const INTERPOLATION_DELAY_MAX_MS = 450;
/** Delay target = nominal tick interval + this × the p90 arrival deviation. */
export const INTERPOLATION_JITTER_MULT = 2;
/** How fast the effective delay chases its target (ms per second — ≤6% warp). */
export const DELAY_SLEW_MS_PER_SEC = 60;
const JITTER_WINDOW = 64; // ~3.2 s of tick arrivals
const BUFFER_SIZE = 32; // ~1.6s of 20 Hz samples — covers DELAY_MAX comfortably

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

export type DelayController = {
  /** Feed one tick frame's arrival (client wall clock + server tick number). */
  onTickArrival(nowMs: number, tickN: number): void;
  /** Slewed effective delay for this frame — call once per rAF (it advances the slew). */
  effectiveDelayMs(nowMs: number): number;
  /** The current effective delay without advancing the slew (for stats). */
  currentDelayMs(): number;
  /** p90 |inter-arrival − nominal| over the window (for stats). */
  jitterMs(): number;
  /** Forget arrival history (reconnect/world-sync — the gap isn't jitter). Keeps the effective delay. */
  reset(): void;
};

export function createDelayController(nominalMs = 50): DelayController {
  const deviations: number[] = [];
  let lastArrivalMs: number | null = null;
  let lastTickN = 0;
  let effective = INTERPOLATION_DELAY_MIN_MS;
  let lastSlewMs: number | null = null;

  const p90 = (): number => {
    if (deviations.length === 0) return 0;
    const sorted = [...deviations].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  };

  return {
    onTickArrival(nowMs, tickN) {
      // Non-increasing tick numbers are dupes/reordered frames, not jitter.
      if (lastTickN !== 0 && tickN <= lastTickN) return;
      if (lastArrivalMs !== null && lastTickN !== 0) {
        // Tick-number-aware: a coalesced TCP burst after a stall is ONE
        // deviation against its combined expected gap, not N violations.
        const expectedGap = (tickN - lastTickN) * nominalMs;
        deviations.push(Math.abs(nowMs - lastArrivalMs - expectedGap));
        if (deviations.length > JITTER_WINDOW) deviations.shift();
      }
      lastArrivalMs = nowMs;
      lastTickN = tickN;
    },

    effectiveDelayMs(nowMs) {
      const target = Math.min(INTERPOLATION_DELAY_MAX_MS, Math.max(INTERPOLATION_DELAY_MIN_MS, nominalMs + INTERPOLATION_JITTER_MULT * p90()));
      if (lastSlewMs !== null) {
        const step = (DELAY_SLEW_MS_PER_SEC * Math.max(0, nowMs - lastSlewMs)) / 1000;
        const error = target - effective;
        effective += Math.sign(error) * Math.min(Math.abs(error), step);
      }
      lastSlewMs = nowMs;
      return effective;
    },

    currentDelayMs: () => effective,
    jitterMs: p90,

    reset() {
      deviations.length = 0;
      lastArrivalMs = null;
      lastTickN = 0;
    }
  };
}
