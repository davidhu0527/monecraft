/**
 * Time-stepping drivers for the simulation. The engine's step(dt) is
 * dt-agnostic; these own how wall time becomes step calls:
 *
 * - createAccumulator — variable-dt catch-up stepping for the browser rAF
 *   loop (the shell's driver; feel-identical to stepping every frame).
 * - createFixedTicker — drift-corrected fixed-rate ticks for a headless
 *   authoritative server, where every world must advance at the same cadence
 *   regardless of callback jitter.
 *
 * Both clamp runaway catch-up the same way: at most MAX_SUBSTEPS steps of at
 * most MAX_STEP_SECONDS are owed at once; time beyond that is quietly dropped
 * (e.g. after a background-tab stall or an event-loop hiccup) rather than run
 * in fast-forward.
 */

/** Longest single step the simulation is fed (bounds per-step integration error). */
export const MAX_STEP_SECONDS = 0.05;
/** Most catch-up steps per advance; older debt is dropped. */
export const MAX_SUBSTEPS = 5;
/** The authoritative-server tick length (20 Hz — one MAX_STEP_SECONDS step per tick). */
export const TICK_SECONDS = MAX_STEP_SECONDS;
export const TICK_RATE = 1 / TICK_SECONDS;

export type Accumulator = {
  /**
   * Advance to wall-clock `nowMs`, invoking `step(dt)` in bounded catch-up
   * substeps. Returns the simulated seconds this call (what audio.sync wants).
   */
  advance(nowMs: number, step: (dt: number) => void): number;
};

/**
 * Catch-up stepping: a slow frame (software GL, busy machine) can take far
 * longer than one step, and a single clamped step would run the simulation in
 * slow motion. Bounded substeps keep sim time tracking wall time; the cap
 * bounds work per frame and quietly drops time beyond it.
 */
export function createAccumulator(opts: { startMs: number; maxStepSeconds?: number; maxSubsteps?: number }): Accumulator {
  const maxStepSeconds = opts.maxStepSeconds ?? MAX_STEP_SECONDS;
  const maxSubsteps = opts.maxSubsteps ?? MAX_SUBSTEPS;
  let last = opts.startMs;
  let pendingSeconds = 0;
  return {
    advance(nowMs, step) {
      pendingSeconds = Math.min(pendingSeconds + (nowMs - last) / 1000, maxStepSeconds * maxSubsteps);
      last = nowMs;

      let stepped = 0;
      // The epsilon floor keeps float residue (0.25 − 5×0.05 ≈ 2e-17) from
      // costing a microscopic extra step; real owed time is far above it.
      while (pendingSeconds > 1e-9) {
        const dt = Math.min(pendingSeconds, maxStepSeconds);
        step(dt);
        pendingSeconds -= dt;
        stepped += dt;
      }
      return stepped;
    }
  };
}

export type FixedTicker = {
  stop(): void;
};

export type FixedTickerOptions = {
  onTick: (dt: number) => void;
  tickSeconds?: number;
  maxCatchUpTicks?: number;
  /** Injectable ms clock and timer for tests; default wall clock + setTimeout. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
};

/**
 * Fixed-rate ticker that schedules each callback against an absolute target
 * time instead of chaining raw delays, so per-callback latency never
 * accumulates into clock drift. If the event loop stalls past
 * `maxCatchUpTicks` owed ticks, the remaining debt is dropped and the
 * schedule re-anchors at the present (mirroring the accumulator's cap).
 */
export function createFixedTicker(opts: FixedTickerOptions): FixedTicker {
  const tickSeconds = opts.tickSeconds ?? TICK_SECONDS;
  const maxCatchUpTicks = opts.maxCatchUpTicks ?? MAX_SUBSTEPS;
  const now = opts.now ?? (() => performance.now());
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id));
  const tickMs = tickSeconds * 1000;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let target = now() + tickMs;

  const fire = () => {
    if (stopped) return;
    let ticks = 0;
    while (now() >= target) {
      opts.onTick(tickSeconds);
      target += tickMs;
      ticks += 1;
      if (ticks >= maxCatchUpTicks && now() >= target) {
        // Stalled well past the cap: drop the debt, re-anchor to the present.
        target = now() + tickMs;
        break;
      }
    }
    if (!stopped) timer = setTimer(fire, Math.max(0, target - now()));
  };
  timer = setTimer(fire, tickMs);

  return {
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
    }
  };
}
