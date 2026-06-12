import { smoothToward, type MusicBrain, type MusicMood } from "./musicBrain";

/** Seconds for brightness/gain to chase a mood change — slow, film-fade pacing. */
const MOOD_TAU = 15;
const REVERB_SECONDS = 2.2;
const MAX_PAD_VOICES = 8;

export type MusicPlayer = {
  /** Advance one frame: smooth the mood and schedule any due notes. */
  sync(dt: number, mood: MusicMood): void;
  dispose(): void;
};

/** Generated exponentially-decaying noise — a procedural reverb impulse. */
function createImpulseBuffer(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * REVERB_SECONDS);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.5;
    }
  }
  return buffer;
}

export function createMusicPlayer(ctx: AudioContext, destination: AudioNode, brain: MusicBrain): MusicPlayer {
  // padInput → lowpass → [dry, convolver → wet] → destination
  const padInput = ctx.createGain();
  padInput.gain.value = 0;
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 1200;
  const dry = ctx.createGain();
  dry.gain.value = 0.6;
  const convolver = ctx.createConvolver();
  convolver.buffer = createImpulseBuffer(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.5;

  padInput.connect(lowpass);
  lowpass.connect(dry).connect(destination);
  lowpass.connect(convolver).connect(wet).connect(destination);

  let activeVoices = 0;
  let disposed = false;

  const playNote = (freq: number, durationSec: number, velocity: number): void => {
    if (activeVoices >= MAX_PAD_VOICES) return;
    const now = ctx.currentTime;
    const voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(0, now);
    voiceGain.gain.linearRampToValueAtTime(velocity, now + durationSec * 0.35);
    voiceGain.gain.linearRampToValueAtTime(0, now + durationSec);
    voiceGain.connect(padInput);

    // Two slightly detuned layers give the pad its width.
    const oscs = [ctx.createOscillator(), ctx.createOscillator()];
    oscs[0].type = "triangle";
    oscs[1].type = "sine";
    oscs[0].frequency.value = freq * 1.003;
    oscs[1].frequency.value = freq * 0.997;
    activeVoices += 1;
    let ended = 0;
    for (const osc of oscs) {
      osc.connect(voiceGain);
      osc.onended = () => {
        osc.disconnect();
        ended += 1;
        if (ended === oscs.length) {
          voiceGain.disconnect();
          activeVoices -= 1;
        }
      };
      osc.start(now);
      osc.stop(now + durationSec + 0.05);
    }
  };

  return {
    sync(dt, mood) {
      if (disposed) return;
      lowpass.frequency.value = smoothToward(lowpass.frequency.value, mood.brightness, dt, MOOD_TAU);
      padInput.gain.value = smoothToward(padInput.gain.value, mood.gain, dt, MOOD_TAU);
      for (const note of brain.next(dt, mood)) playNote(note.freq, note.durationSec, note.velocity);
    },
    dispose() {
      disposed = true;
      padInput.disconnect();
      lowpass.disconnect();
      dry.disconnect();
      convolver.disconnect();
      wet.disconnect();
    }
  };
}
