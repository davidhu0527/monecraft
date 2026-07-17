import { describe, expect, test } from "bun:test";
import type { SaveData } from "@/lib/game/types";
import { MAX_DECOMPRESSED_SAVE_BYTES, parseSaveBlob } from "./persistence";

/**
 * The seam where stored bytes become engine state. Everything here is about
 * refusing bad input without taking the process down with it.
 */

const gzip = (text: string) => Bun.gzipSync(new TextEncoder().encode(text));

const minimalSave = (): SaveData => ({ version: 18, seed: 1337, changes: [], players: [] }) as unknown as SaveData;

describe("parseSaveBlob", () => {
  test("round-trips a stored save through the validation/migration chain", async () => {
    const parsed = await parseSaveBlob(gzip(JSON.stringify(minimalSave())));
    expect(parsed).not.toBeNull();
    expect(parsed!.seed).toBe(1337);
    expect(parsed!.version).toBe(18);
  });

  test("rejects bytes that aren't gzip, and gzip that isn't a save", async () => {
    expect(await parseSaveBlob(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(await parseSaveBlob(gzip("not json at all"))).toBeNull();
    expect(await parseSaveBlob(gzip(JSON.stringify({ nope: true })))).toBeNull();
  });

  // Deliberately a *valid, parseable* save inflated past the cap — not garbage.
  // Garbage would prove nothing: an unbounded inflate would allocate the whole
  // thing and then still return null from the JSON parse, so the test would pass
  // with or without the bound. Here the only thing that can produce null is the
  // cap, and the pair below pins it: same bytes, bigger cap, parses fine.
  test("refuses to inflate past its cap (decompression bomb)", async () => {
    const bomb = gzip(JSON.stringify({ ...minimalSave(), pad: "x".repeat(8 * 1024 * 1024) }));
    expect(bomb.byteLength).toBeLessThan(64 * 1024); // ~8 MiB of heap from a few KiB of stored bytes

    expect(await parseSaveBlob(bomb, 1024 * 1024)).toBeNull(); // capped below it → refused
    expect(await parseSaveBlob(bomb, 16 * 1024 * 1024)).not.toBeNull(); // capped above it → the same bytes parse
  });

  test("the default cap is generous next to a real save, but bounded", () => {
    expect(MAX_DECOMPRESSED_SAVE_BYTES).toBeGreaterThan(16 * 1024 * 1024);
    expect(MAX_DECOMPRESSED_SAVE_BYTES).toBeLessThan(256 * 1024 * 1024);
  });
});
