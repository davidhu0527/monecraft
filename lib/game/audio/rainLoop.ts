/**
 * A continuous rain bed: a looping white-noise buffer through a lowpass into a
 * gain that ramps with intensity. Fully synthesized (no asset), lives off the
 * one-shot SFX voice budget, and is silent at intensity 0.
 */
export type RainLoop = {
  setIntensity(level: number): void;
  dispose(): void;
};

const MAX_GAIN = 0.16;

export function createRainLoop(ctx: AudioContext, destination: AudioNode): RainLoop {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1600;
  const gain = ctx.createGain();
  gain.gain.value = 0;

  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.start();

  let disposed = false;
  return {
    setIntensity(level) {
      if (disposed) return;
      const target = Math.max(0, Math.min(1, level)) * MAX_GAIN;
      gain.gain.setTargetAtTime(target, ctx.currentTime, 0.4);
    },
    dispose() {
      disposed = true;
      try {
        source.stop();
      } catch {
        // already stopped
      }
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    }
  };
}
