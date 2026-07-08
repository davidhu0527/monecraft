import type { DimensionId } from "@/lib/game/types";

/**
 * Per-dimension rendering environment. Swap-on-travel rebuilds the renderer
 * with the target dimension's profile, so these are construction-time
 * constants — no uniforms, no live switching (the shader bakes skyLightFloor
 * into its source string).
 */
export type DimensionProfile = {
  /** Sky gradient endpoints; `daylight` lerps between them each frame. */
  daySky: number;
  nightSky: number;
  /** Distance fog band (the overcast effect still pulls `far` in). */
  fogNear: number;
  fogFar: number;
  /**
   * The shader's minimum visibility for sky-gated terrain — the overworld's
   * cave-darkness floor. The nether has no sky light at all (its bedrock
   * ceiling zeroes the bake), so a raised floor IS its ambient glow.
   */
  skyLightFloor: number;
  /** Sun/moon/stars/clouds — a sky view exists only where there is a sky. */
  celestials: boolean;
  /** The rain/snow layer (the engine also keeps nether weather clear). */
  precipitation: boolean;
};

export const DIMENSION_PROFILES: Record<DimensionId, DimensionProfile> = {
  overworld: {
    daySky: 0x8bc2ff,
    nightSky: 0x06111f,
    fogNear: 30,
    fogFar: 200,
    skyLightFloor: 0.05,
    celestials: true,
    precipitation: true
  },
  nether: {
    // A dark ember haze: "day" and "night" barely differ (daylight is pinned
    // anyway), the fog hugs close for an enclosed feel, and the raised light
    // floor keeps netherrack readable with no sky light at all.
    daySky: 0x2a0d0a,
    nightSky: 0x1a0605,
    fogNear: 12,
    fogFar: 90,
    skyLightFloor: 0.18,
    celestials: false,
    precipitation: false
  }
};
