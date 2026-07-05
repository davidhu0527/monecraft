import { describe, expect, test } from "bun:test";
import { createPredictionLedger, ECHO_SUPPRESS_EXTRA_MS, PREDICTION_TIMEOUT_MAX_MS, PREDICTION_TIMEOUT_MIN_MS, predictionTimeoutMs } from "./prediction";

const DIRT = 3;
const AIR = 0;

describe("prediction timeout", () => {
  test("2×RTT+200 clamped to [1000, 5000]", () => {
    expect(predictionTimeoutMs(0)).toBe(PREDICTION_TIMEOUT_MIN_MS);
    expect(predictionTimeoutMs(400)).toBe(1000);
    expect(predictionTimeoutMs(900)).toBe(2000);
    expect(predictionTimeoutMs(10_000)).toBe(PREDICTION_TIMEOUT_MAX_MS);
  });
});

describe("prediction ledger", () => {
  test("a matching journal write confirms and retires; nothing refunds", () => {
    const ledger = createPredictionLedger();
    ledger.add("place", [{ idx: 42, block: DIRT, prev: AIR }], { itemId: "dirt", count: 1 }, 0, 100);
    expect(ledger.size()).toBe(1);
    expect(ledger.onJournal(42, DIRT).refunds).toEqual([]);
    expect(ledger.size()).toBe(0);
    expect(ledger.expire(999_999)).toEqual([]); // retired — never expires
  });

  test("a multi-cell prediction (door) retires only when every cell confirms", () => {
    const ledger = createPredictionLedger();
    ledger.add(
      "place",
      [
        { idx: 10, block: 21, prev: AIR },
        { idx: 20, block: 22, prev: AIR }
      ],
      { itemId: "door", count: 1 },
      0,
      100
    );
    ledger.onJournal(10, 21);
    expect(ledger.size()).toBe(1); // half-confirmed
    ledger.onJournal(20, 22);
    expect(ledger.size()).toBe(0);
  });

  test("a mismatching write drops the whole prediction and surfaces the refund", () => {
    const ledger = createPredictionLedger();
    ledger.add("place", [{ idx: 42, block: DIRT, prev: AIR }], { itemId: "dirt", count: 1 }, 0, 100);
    const { refunds, reverts } = ledger.onJournal(42, 7); // someone else's block won the race
    expect(refunds).toEqual([{ itemId: "dirt", count: 1 }]);
    expect(reverts).toEqual([]); // single-cell: no sibling to strand
    expect(ledger.size()).toBe(0);
    expect(ledger.expire(999_999)).toEqual([]); // dropped — no later revert of a cell the server owns
  });

  test("a mismatch on one cell of a multi-cell prediction surfaces the unconfirmed sibling for revert", () => {
    const ledger = createPredictionLedger();
    ledger.add(
      "place",
      [
        { idx: 10, block: 21, prev: AIR },
        { idx: 20, block: 22, prev: AIR }
      ],
      { itemId: "door", count: 1 },
      0,
      100
    );
    const { refunds, reverts } = ledger.onJournal(10, 7); // lower cell lost the race
    expect(refunds).toEqual([{ itemId: "door", count: 1 }]);
    expect(reverts).toEqual([{ idx: 20, block: 22, prev: AIR, confirmed: false }]); // the upper half must not ghost
    expect(ledger.size()).toBe(0);
  });

  test("confirmed siblings are NOT surfaced for revert on a later mismatch", () => {
    const ledger = createPredictionLedger();
    ledger.add(
      "place",
      [
        { idx: 10, block: 21, prev: AIR },
        { idx: 20, block: 22, prev: AIR }
      ],
      null,
      0,
      100
    );
    ledger.onJournal(20, 22); // upper confirmed first
    const { reverts } = ledger.onJournal(10, 7); // then the lower mismatches
    expect(reverts).toEqual([]); // the server said the upper is right — leave it
  });

  test("breaks carry no refund even on override", () => {
    const ledger = createPredictionLedger();
    ledger.add("break", [{ idx: 42, block: AIR, prev: DIRT }], null, 0, 100);
    expect(ledger.onJournal(42, DIRT).refunds).toEqual([]);
    expect(ledger.size()).toBe(0);
  });

  test("expiry honors the deadline, returns newest-first, and removes entries", () => {
    const ledger = createPredictionLedger();
    ledger.add("place", [{ idx: 1, block: DIRT, prev: AIR }], null, 0, 0); // deadline 1000
    ledger.add("place", [{ idx: 2, block: DIRT, prev: AIR }], null, 500, 0); // deadline 1500
    expect(ledger.expire(999)).toEqual([]);
    const first = ledger.expire(1000);
    expect(first.map((p) => p.edits[0].idx)).toEqual([1]);
    const second = ledger.expire(5000);
    expect(second.map((p) => p.edits[0].idx)).toEqual([2]);
    expect(ledger.size()).toBe(0);
  });

  test("newest-first ordering when several expire at once", () => {
    const ledger = createPredictionLedger();
    ledger.add("place", [{ idx: 1, block: DIRT, prev: AIR }], null, 0, 0);
    ledger.add("place", [{ idx: 2, block: DIRT, prev: AIR }], null, 1, 0);
    ledger.add("place", [{ idx: 3, block: DIRT, prev: AIR }], null, 2, 0);
    expect(ledger.expire(999_999).map((p) => p.edits[0].idx)).toEqual([3, 2, 1]);
  });

  test("the suppress window opens on add and OUTLIVES confirmation", () => {
    const ledger = createPredictionLedger();
    ledger.add("place", [{ idx: 42, block: DIRT, prev: AIR }], null, 1000, 100);
    expect(ledger.shouldSuppress(42, 1000)).toBe(true);
    ledger.onJournal(42, DIRT); // confirmed + retired — the echo rides this same tick
    expect(ledger.shouldSuppress(42, 1001)).toBe(true);
    const deadline = 1000 + predictionTimeoutMs(100);
    expect(ledger.shouldSuppress(42, deadline + ECHO_SUPPRESS_EXTRA_MS)).toBe(true);
    expect(ledger.shouldSuppress(42, deadline + ECHO_SUPPRESS_EXTRA_MS + 1)).toBe(false);
    expect(ledger.shouldSuppress(7, 1000)).toBe(false); // unrelated cell
  });

  test("clear drops pending predictions and suppress windows", () => {
    const ledger = createPredictionLedger();
    ledger.add("place", [{ idx: 42, block: DIRT, prev: AIR }], { itemId: "dirt", count: 1 }, 0, 100);
    ledger.clear();
    expect(ledger.size()).toBe(0);
    expect(ledger.shouldSuppress(42, 1)).toBe(false);
    expect(ledger.expire(999_999)).toEqual([]);
  });

  test("empty edit lists are ignored", () => {
    const ledger = createPredictionLedger();
    ledger.add("place", [], { itemId: "dirt", count: 1 }, 0, 100);
    expect(ledger.size()).toBe(0);
  });
});
