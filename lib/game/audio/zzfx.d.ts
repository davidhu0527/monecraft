/**
 * The zzfx npm package ships untyped JS. Only the pure sample generator is
 * declared here — ZZFX.play/zzfx() route through the package's own module-scope
 * AudioContext, which this codebase must never use (see synth.ts).
 */
declare module "zzfx" {
  export const ZZFX: {
    /** Master volume baked into generated samples (default 0.3). */
    volume: number;
    /** Sample rate of generated samples (default 44100). */
    sampleRate: number;
    /** Renders a ZZFX parameter array to raw mono samples. Pure. */
    buildSamples(...parameters: ReadonlyArray<number | undefined>): number[];
  };
}
