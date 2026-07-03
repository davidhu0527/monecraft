import { describe, expect, test } from "bun:test";
import { createAccumulator, createFixedTicker, MAX_STEP_SECONDS, MAX_SUBSTEPS, TICK_SECONDS } from "./tickDriver";

describe("createAccumulator", () => {
  test("a normal frame steps once with the frame delta", () => {
    const acc = createAccumulator({ startMs: 1000 });
    const steps: number[] = [];
    const stepped = acc.advance(1016, (dt) => steps.push(dt));
    expect(steps).toEqual([0.016]);
    expect(stepped).toBeCloseTo(0.016, 9);
  });

  test("a slow frame catches up in bounded substeps instead of one slow-motion step", () => {
    const acc = createAccumulator({ startMs: 0 });
    const steps: number[] = [];
    acc.advance(120, (dt) => steps.push(dt)); // 120ms owed → 50 + 50 + ~20
    expect(steps).toHaveLength(3);
    expect(steps[0]).toBe(MAX_STEP_SECONDS);
    expect(steps[1]).toBe(MAX_STEP_SECONDS);
    expect(steps[2]).toBeCloseTo(0.02, 9);
  });

  test("time beyond the substep cap is dropped (background-tab stall)", () => {
    const acc = createAccumulator({ startMs: 0 });
    const steps: number[] = [];
    const stepped = acc.advance(10_000, (dt) => steps.push(dt));
    expect(steps).toHaveLength(MAX_SUBSTEPS);
    expect(stepped).toBeCloseTo(MAX_STEP_SECONDS * MAX_SUBSTEPS, 9);
    // The dropped time is gone: the next normal frame owes only its own delta.
    steps.length = 0;
    acc.advance(10_016, (dt) => steps.push(dt));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toBeCloseTo(0.016, 9);
  });

  test("leftover fractions accumulate across frames rather than being lost", () => {
    const acc = createAccumulator({ startMs: 0, maxStepSeconds: 0.05 });
    let total = 0;
    for (let frame = 1; frame <= 100; frame += 1) {
      total += acc.advance(frame * 16.7, (dt) => void dt);
    }
    expect(total).toBeCloseTo(1.67, 6);
  });
});

/**
 * Manually-pumped clock + timer queue. advanceTo(ms) jumps the clock to `ms`
 * FIRST, then fires everything due — so a big jump models a stalled event
 * loop (timers fire late and see the late clock), while many small jumps
 * model a punctual one. That distinction is exactly what the ticker's
 * drift/catch-up logic exists for.
 */
function fakeTime() {
  let nowMs = 0;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let nextId = 1;
  return {
    now: () => nowMs,
    setTimer(fn: () => void, ms: number) {
      const id = nextId++;
      timers.push({ at: nowMs + ms, fn, id });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer(id: ReturnType<typeof setTimeout>) {
      const i = timers.findIndex((t) => t.id === (id as unknown as number));
      if (i >= 0) timers.splice(i, 1);
    },
    /** Jump the clock to `ms`, then fire all due timers (each may schedule more). */
    advanceTo(ms: number) {
      nowMs = ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > ms) break;
        timers.shift();
        next.fn();
      }
    },
    /** Advance punctually in `stepMs` hops (timers fire ~on time). */
    run(toMs: number, stepMs = 10) {
      for (let t = nowMs + stepMs; t <= toMs; t += stepMs) this.advanceTo(t);
    }
  };
}

describe("createFixedTicker", () => {
  test("ticks at the fixed rate with the fixed dt under a punctual clock", () => {
    const time = fakeTime();
    const ticks: number[] = [];
    const ticker = createFixedTicker({ onTick: (dt) => ticks.push(dt), now: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer });
    time.run(1000);
    expect(ticks).toHaveLength(20); // 20 Hz × 1s
    expect(ticks.every((dt) => dt === TICK_SECONDS)).toBe(true);
    ticker.stop();
  });

  test("does not drift: chronically-late callbacks still average the fixed rate", () => {
    const time = fakeTime();
    let count = 0;
    const ticker = createFixedTicker({ onTick: () => (count += 1), now: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer });
    // Wake in awkward 37ms lumps, so every callback fires late. A delay-chained
    // ticker re-waits the full interval from each late wake and slips ~37% of
    // the rate; an absolute-target schedule loses no ticks at all.
    time.run(10_000, 37);
    expect(count).toBeGreaterThanOrEqual(199); // exact-rate 200, ± the tail tick
    expect(count).toBeLessThanOrEqual(200);
    ticker.stop();
  });

  test("a long stall catches up at most maxCatchUpTicks then drops the debt", () => {
    const time = fakeTime();
    let count = 0;
    const ticker = createFixedTicker({
      onTick: () => (count += 1),
      maxCatchUpTicks: 5,
      now: time.now,
      setTimer: time.setTimer,
      clearTimer: time.clearTimer
    });
    time.advanceTo(10); // nothing yet
    expect(count).toBe(0);
    time.advanceTo(5000); // one 5s stall ≈ 100 owed ticks → capped burst, debt dropped
    expect(count).toBe(5);
    // Re-anchored at the stall's end (next tick 5050): the following punctual
    // second ticks normally — 5050, 5100, …, 6000 inclusive is 20 ticks.
    time.run(6000);
    expect(count).toBe(5 + 20);
    ticker.stop();
  });

  test("stop() prevents any further ticks", () => {
    const time = fakeTime();
    let count = 0;
    const ticker = createFixedTicker({ onTick: () => (count += 1), now: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer });
    time.run(500);
    const at = count;
    ticker.stop();
    time.run(2000);
    expect(count).toBe(at);
  });
});
