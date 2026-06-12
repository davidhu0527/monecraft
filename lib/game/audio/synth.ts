import type { SoundDef, ZzfxParams } from "./soundParams";

export type PlayOptions = {
  /** Linear gain multiplier on top of the recipe volume (default 1). */
  gain?: number;
  /** Stereo position -1..1 (default 0). */
  pan?: number;
  /** Playback rate multiplier — shifts pitch and duration (default 1). */
  rate?: number;
};

/**
 * The only audio seam that touches WebAudio. The director and schedulers
 * depend on this interface, so headless tests inject a recording fake.
 */
export type SynthBackend = {
  /** Audio clock in seconds (ctx.currentTime). */
  now(): number;
  play(def: SoundDef, opts?: PlayOptions): void;
  dispose(): void;
};

/** ZZFX.buildSamples signature, injected so this module never imports zzfx. */
export type BuildSamples = (...parameters: ZzfxParams) => number[];

const MAX_VOICES = 10;

export function createSynthBackend(ctx: AudioContext, destination: AudioNode, buildSamples: BuildSamples, sampleRate = 44100): SynthBackend {
  // Buffers are rendered once per SoundDef with randomness stripped; per-play
  // pitch variation comes from playbackRate jitter instead, so the cache stays
  // valid and play() never re-synthesizes.
  const buffers = new Map<SoundDef, AudioBuffer | null>();
  const lastPlayedAt = new Map<SoundDef, number>();
  let activeVoices = 0;
  let disposed = false;

  const bufferFor = (def: SoundDef): AudioBuffer | null => {
    const cached = buffers.get(def);
    if (cached !== undefined) return cached;
    const params = [...def.params];
    params[1] = 0; // strip baked-in randomness; play() jitters playbackRate instead
    const samples = buildSamples(...params);
    let buffer: AudioBuffer | null = null;
    if (samples.length > 0) {
      buffer = ctx.createBuffer(1, samples.length, sampleRate);
      buffer.getChannelData(0).set(samples);
    }
    buffers.set(def, buffer);
    return buffer;
  };

  return {
    now: () => ctx.currentTime,

    play(def, opts = {}) {
      if (disposed || activeVoices >= MAX_VOICES) return;
      const now = ctx.currentTime;
      const retriggerSec = (def.minRetriggerMs ?? 0) / 1000;
      const last = lastPlayedAt.get(def);
      if (last !== undefined && now - last < retriggerSec) return;

      const buffer = bufferFor(def);
      if (!buffer) return;
      lastPlayedAt.set(def, now);

      const randomness = def.params[1] ?? 0.05;
      const jitter = 1 + (Math.random() * 2 - 1) * randomness;

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = (opts.rate ?? 1) * jitter;
      const gain = ctx.createGain();
      gain.gain.value = opts.gain ?? 1;
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, opts.pan ?? 0));

      source.connect(gain).connect(panner).connect(destination);
      activeVoices += 1;
      source.onended = () => {
        activeVoices -= 1;
        source.disconnect();
        gain.disconnect();
        panner.disconnect();
      };
      source.start();
    },

    dispose() {
      disposed = true;
      buffers.clear();
    }
  };
}
