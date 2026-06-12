import { describe, expect, test } from "bun:test";
import { BiomeId } from "@/lib/world";
import { createMusicBrain, moodFor, smoothToward, type NoteEvent } from "./musicBrain";

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

describe("moodFor", () => {
  test("day is brighter, denser, and in a different key than night", () => {
    const day = moodFor(0.9, BiomeId.Plains);
    const night = moodFor(0.05, BiomeId.Plains);
    expect(day.brightness).toBeGreaterThan(night.brightness);
    expect(day.noteIntervalSec).toBeLessThan(night.noteIntervalSec);
    expect(day.rootHz).not.toBe(night.rootHz);
    expect(day.scale).not.toEqual(night.scale);
  });

  test("biomes flavor the base mood", () => {
    const plains = moodFor(0.9, BiomeId.Plains);
    expect(moodFor(0.9, BiomeId.Desert).rootHz).toBeLessThan(plains.rootHz);
    expect(moodFor(0.9, BiomeId.Ocean).noteIntervalSec).toBeGreaterThan(plains.noteIntervalSec);
    expect(moodFor(0.9, BiomeId.Mountains).rootHz).toBe(plains.rootHz * 2);
  });
});

describe("smoothToward", () => {
  test("approaches the target without overshooting and is frame-rate independent-ish", () => {
    let coarse = 0;
    coarse = smoothToward(coarse, 100, 1, 5);
    let fine = 0;
    for (let i = 0; i < 60; i += 1) fine = smoothToward(fine, 100, 1 / 60, 5);
    expect(coarse).toBeGreaterThan(0);
    expect(coarse).toBeLessThan(100);
    expect(fine).toBeCloseTo(coarse, 5);
  });
});

describe("music brain", () => {
  function play(seconds: number, daylight: number, seed = 1): NoteEvent[] {
    const brain = createMusicBrain(mulberry32(seed));
    const mood = moodFor(daylight, BiomeId.Plains);
    const notes: NoteEvent[] = [];
    const dt = 1 / 30;
    for (let t = 0; t < seconds; t += dt) notes.push(...brain.next(dt, mood));
    return notes;
  }

  test("emits a steady trickle of notes", () => {
    const notes = play(120, 0.9);
    // Day interval ~3.2 s → roughly 30–50 notes (plus sparkles) in 2 minutes.
    expect(notes.length).toBeGreaterThan(20);
    expect(notes.length).toBeLessThan(70);
  });

  test("every note lies on the current scale", () => {
    const mood = moodFor(0.9, BiomeId.Plains);
    const allowed = new Set(mood.scale.map((semis) => Math.round(1200 * Math.log2(2 ** (semis / 12)))));
    for (const note of play(120, 0.9)) {
      // Cents above the root, folded into one octave-agnostic pitch class set.
      const cents = Math.round(1200 * Math.log2(note.freq / mood.rootHz)) % 1200;
      const inScale = [...allowed].some((a) => a % 1200 === cents % 1200);
      expect(inScale).toBe(true);
      expect(note.durationSec).toBeGreaterThan(0);
      expect(note.velocity).toBeGreaterThan(0);
      expect(note.velocity).toBeLessThanOrEqual(1);
    }
  });

  test("is deterministic under a seeded rng", () => {
    expect(play(60, 0.9, 42)).toEqual(play(60, 0.9, 42));
    expect(play(60, 0.9, 42)).not.toEqual(play(60, 0.9, 43));
  });
});
