import { describe, expect, test } from "bun:test";
import { qAng, qPos } from "./codec";

describe("pose quantizers", () => {
  test("qPos rounds to 2 decimals and shortens JSON output", () => {
    expect(qPos(256.04500000000002)).toBe(256.05);
    expect(qPos(1 / 3)).toBe(0.33);
    expect(qPos(-1 / 3)).toBe(-0.33);
    expect(qPos(0)).toBe(0);
    expect(JSON.stringify(qPos(128.00000000000003))).toBe("128");
    expect(JSON.stringify(qPos(1 / 3)).length).toBeLessThanOrEqual(6);
  });

  test("qAng rounds to 3 decimals", () => {
    expect(qAng(Math.PI)).toBe(3.142);
    expect(qAng(-Math.PI / 2)).toBe(-1.571);
    expect(qAng(0)).toBe(0);
  });

  test("quantization is idempotent (the wire assertion the room test relies on)", () => {
    for (const v of [12.345678, -0.005, 99.999, 0.1 + 0.2]) {
      expect(qPos(qPos(v))).toBe(qPos(v));
      expect(qAng(qAng(v))).toBe(qAng(v));
    }
  });
});
