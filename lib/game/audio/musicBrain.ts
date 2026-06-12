import { BiomeId } from "@/lib/world";

/**
 * The generative composer — pure data and arithmetic, no WebAudio. It decides
 * what the ambient pad should play; musicPlayer.ts turns that into sound.
 */

export type MusicMood = {
  /** Tonic of the current key. Switches discretely at note boundaries. */
  rootHz: number;
  /** Scale degrees in semitones above the root. */
  scale: readonly number[];
  /** Average seconds between pad notes. */
  noteIntervalSec: number;
  /** Lowpass cutoff target in Hz — the player smooths toward it. */
  brightness: number;
  /** Pad gain target 0..1 — the player smooths toward it. */
  gain: number;
};

export type NoteEvent = {
  freq: number;
  durationSec: number;
  /** Loudness 0..1 relative to the pad gain. */
  velocity: number;
};

// Two octaves of pentatonic — wide enough for a wandering pad, no avoid notes.
const MAJOR_PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21] as const;
const MINOR_PENTATONIC = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22] as const;

const C3 = 130.81;
const A2 = 110;

/** Day/night picks key and energy; the biome flavors register and pacing. */
export function moodFor(daylight: number, biome: BiomeId): MusicMood {
  const night = daylight < 0.35;
  const mood: MusicMood = night
    ? { rootHz: A2, scale: MINOR_PENTATONIC, noteIntervalSec: 5, brightness: 550, gain: 0.5 }
    : { rootHz: C3, scale: MAJOR_PENTATONIC, noteIntervalSec: 3.2, brightness: 2200, gain: 0.65 };

  switch (biome) {
    case BiomeId.Desert:
      return { ...mood, rootHz: mood.rootHz * 2 ** (-3 / 12), noteIntervalSec: mood.noteIntervalSec + 0.8 };
    case BiomeId.Ocean:
      return { ...mood, noteIntervalSec: mood.noteIntervalSec + 1.4, brightness: mood.brightness * 0.75 };
    case BiomeId.Forest:
      return { ...mood, noteIntervalSec: mood.noteIntervalSec - 0.4 };
    case BiomeId.Mountains:
      return { ...mood, rootHz: mood.rootHz * 2, brightness: mood.brightness * 1.15, gain: mood.gain * 0.85 };
    default:
      return mood;
  }
}

/** Exponential approach with time constant tau — frame-rate independent. */
export function smoothToward(current: number, target: number, dt: number, tau: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

export type MusicBrain = {
  /** Advances the composition clock; returns notes due this frame. */
  next(dt: number, mood: MusicMood): readonly NoteEvent[];
};

export function createMusicBrain(rng: () => number = Math.random): MusicBrain {
  let degree = 0;
  let noteTimer = 1.5; // short lead-in before the first note

  return {
    next(dt, mood) {
      const notes: NoteEvent[] = [];
      noteTimer -= dt;
      // Accumulate (+=) rather than reset so a late frame's overshoot carries
      // into the next interval instead of being dropped.
      while (noteTimer <= 0) {
        noteTimer += mood.noteIntervalSec * (0.7 + rng() * 0.6);

        // Mostly stepwise wandering, with an occasional larger leap.
        const roll = rng();
        const step = roll < 0.4 ? -1 : roll < 0.8 ? 1 : roll < 0.9 ? -2 : 2;
        degree = Math.max(0, Math.min(mood.scale.length - 1, degree + step));

        const freq = mood.rootHz * 2 ** (mood.scale[degree] / 12);
        notes.push({
          freq,
          durationSec: mood.noteIntervalSec * (1.6 + rng() * 0.8),
          velocity: 0.6 + rng() * 0.4
        });
        // A sparse high sparkle an octave up, layered over the pad note.
        if (rng() < 0.15) {
          notes.push({ freq: freq * 2, durationSec: mood.noteIntervalSec * 0.8, velocity: 0.25 + rng() * 0.15 });
        }
      }
      return notes;
    }
  };
}
