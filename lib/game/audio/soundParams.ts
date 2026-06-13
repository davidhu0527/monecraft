import type { MobKind } from "@/lib/game/types";
import type { MaterialGroup } from "./materials";

/**
 * Positional ZZFX parameter array, the format ZZFX.buildSamples consumes and
 * the ZZFX designer (https://killedbyapixel.github.io/ZzFX/) exports. Holes in
 * designer output (`[,,129,...]`) become explicit `undefined` so ZZFX's own
 * per-parameter defaults still apply (0 is NOT a neutral value for several).
 */
export type ZzfxParams = ReadonlyArray<number | undefined>;

/** Named view of the 21 positional ZZFX parameters — keeps the tables readable. */
type ZzfxSpec = Partial<{
  volume: number;
  randomness: number;
  frequency: number;
  attack: number;
  sustain: number;
  release: number;
  /** 0 sin, 1 triangle, 2 saw, 3 tan, 4 noise, 5 square duty */
  shape: number;
  shapeCurve: number;
  slide: number;
  deltaSlide: number;
  pitchJump: number;
  pitchJumpTime: number;
  repeatTime: number;
  noise: number;
  modulation: number;
  bitCrush: number;
  delay: number;
  sustainVolume: number;
  decay: number;
  tremolo: number;
  /** Negative = lowpass at |Hz|, positive = highpass at Hz. */
  filter: number;
}>;

function zz(s: ZzfxSpec): ZzfxParams {
  return [
    s.volume,
    s.randomness,
    s.frequency,
    s.attack,
    s.sustain,
    s.release,
    s.shape,
    s.shapeCurve,
    s.slide,
    s.deltaSlide,
    s.pitchJump,
    s.pitchJumpTime,
    s.repeatTime,
    s.noise,
    s.modulation,
    s.bitCrush,
    s.delay,
    s.sustainVolume,
    s.decay,
    s.tremolo,
    s.filter
  ];
}

export type SoundDef = {
  params: ZzfxParams;
  /** Replays within this window are dropped (catch-up substeps fire event bursts). */
  minRetriggerMs?: number;
};

/** Block breaking — the loudest of the material sounds. */
export const BREAK_SOUNDS: Record<MaterialGroup, SoundDef> = {
  stone: {
    params: zz({
      volume: 1.1,
      frequency: 60,
      sustain: 0.03,
      release: 0.15,
      shape: 4,
      shapeCurve: 1.5,
      noise: 0.9,
      sustainVolume: 0.9,
      decay: 0.05,
      filter: -900
    }),
    minRetriggerMs: 50
  },
  wood: {
    params: zz({
      volume: 1,
      frequency: 120,
      sustain: 0.02,
      release: 0.12,
      shape: 4,
      shapeCurve: 1.2,
      slide: -2,
      noise: 0.4,
      sustainVolume: 0.8,
      decay: 0.04,
      filter: -600
    }),
    minRetriggerMs: 50
  },
  grass: {
    params: zz({
      volume: 0.8,
      randomness: 0.1,
      frequency: 80,
      sustain: 0.02,
      release: 0.09,
      shape: 4,
      shapeCurve: 0.8,
      noise: 0.8,
      sustainVolume: 0.7,
      decay: 0.03,
      filter: -400
    }),
    minRetriggerMs: 50
  },
  sand: {
    params: zz({
      volume: 0.7,
      randomness: 0.1,
      frequency: 150,
      sustain: 0.03,
      release: 0.12,
      shape: 4,
      shapeCurve: 0.6,
      noise: 1.2,
      sustainVolume: 0.6,
      decay: 0.05,
      filter: 500
    }),
    minRetriggerMs: 50
  },
  glass: {
    params: zz({
      volume: 0.9,
      randomness: 0.15,
      frequency: 900,
      sustain: 0.01,
      release: 0.2,
      shape: 4,
      shapeCurve: 1.5,
      pitchJump: 400,
      pitchJumpTime: 0.04,
      noise: 0.3,
      sustainVolume: 0.7,
      decay: 0.07
    }),
    minRetriggerMs: 50
  },
  water: {
    params: zz({
      volume: 0.8,
      randomness: 0.1,
      frequency: 200,
      attack: 0.02,
      sustain: 0.08,
      release: 0.25,
      shape: 4,
      shapeCurve: 0.9,
      slide: -4,
      deltaSlide: -2,
      noise: 0.7,
      sustainVolume: 0.6,
      decay: 0.1,
      filter: -500
    }),
    minRetriggerMs: 50
  }
};

/** Block placing — a shorter, softer thud of the same material. */
export const PLACE_SOUNDS: Record<MaterialGroup, SoundDef> = {
  stone: {
    params: zz({
      volume: 0.7,
      frequency: 70,
      sustain: 0.01,
      release: 0.07,
      shape: 4,
      shapeCurve: 1.5,
      noise: 0.8,
      sustainVolume: 0.8,
      decay: 0.02,
      filter: -800
    }),
    minRetriggerMs: 50
  },
  wood: {
    params: zz({
      volume: 0.6,
      frequency: 140,
      sustain: 0.01,
      release: 0.06,
      shape: 4,
      shapeCurve: 1.2,
      noise: 0.4,
      sustainVolume: 0.8,
      decay: 0.02,
      filter: -600
    }),
    minRetriggerMs: 50
  },
  grass: {
    params: zz({
      volume: 0.5,
      randomness: 0.1,
      frequency: 90,
      sustain: 0.01,
      release: 0.05,
      shape: 4,
      shapeCurve: 0.8,
      noise: 0.7,
      sustainVolume: 0.7,
      decay: 0.02,
      filter: -400
    }),
    minRetriggerMs: 50
  },
  sand: {
    params: zz({
      volume: 0.45,
      randomness: 0.1,
      frequency: 150,
      sustain: 0.02,
      release: 0.06,
      shape: 4,
      shapeCurve: 0.6,
      noise: 1,
      sustainVolume: 0.6,
      decay: 0.03,
      filter: 400
    }),
    minRetriggerMs: 50
  },
  glass: {
    params: zz({ volume: 0.5, randomness: 0.1, frequency: 700, sustain: 0.01, release: 0.08, shape: 0, sustainVolume: 0.8, decay: 0.03 }),
    minRetriggerMs: 50
  },
  water: {
    params: zz({
      volume: 0.5,
      randomness: 0.1,
      frequency: 180,
      attack: 0.01,
      sustain: 0.04,
      release: 0.15,
      shape: 4,
      shapeCurve: 0.9,
      slide: -3,
      noise: 0.6,
      sustainVolume: 0.6,
      decay: 0.06,
      filter: -500
    }),
    minRetriggerMs: 50
  }
};

/** Footsteps — quiet and clipped; the scheduler controls cadence. */
export const FOOTSTEP_SOUNDS: Record<MaterialGroup, SoundDef> = {
  stone: {
    params: zz({
      volume: 0.35,
      randomness: 0.15,
      frequency: 70,
      sustain: 0.01,
      release: 0.04,
      shape: 4,
      shapeCurve: 1.5,
      noise: 0.7,
      sustainVolume: 0.6,
      decay: 0.01,
      filter: -700
    })
  },
  wood: {
    params: zz({
      volume: 0.3,
      randomness: 0.15,
      frequency: 110,
      sustain: 0.01,
      release: 0.04,
      shape: 4,
      shapeCurve: 1.2,
      noise: 0.4,
      sustainVolume: 0.6,
      decay: 0.01,
      filter: -500
    })
  },
  grass: {
    params: zz({
      volume: 0.25,
      randomness: 0.2,
      frequency: 90,
      sustain: 0.01,
      release: 0.035,
      shape: 4,
      shapeCurve: 0.8,
      noise: 0.8,
      sustainVolume: 0.5,
      decay: 0.01,
      filter: -350
    })
  },
  sand: {
    params: zz({
      volume: 0.22,
      randomness: 0.2,
      frequency: 140,
      sustain: 0.015,
      release: 0.05,
      shape: 4,
      shapeCurve: 0.6,
      noise: 1.1,
      sustainVolume: 0.5,
      decay: 0.015,
      filter: 300
    })
  },
  glass: {
    params: zz({
      volume: 0.3,
      randomness: 0.15,
      frequency: 70,
      sustain: 0.01,
      release: 0.04,
      shape: 4,
      shapeCurve: 1.5,
      noise: 0.7,
      sustainVolume: 0.6,
      decay: 0.01,
      filter: -700
    })
  },
  water: {
    params: zz({
      volume: 0.3,
      randomness: 0.2,
      frequency: 160,
      attack: 0.01,
      sustain: 0.02,
      release: 0.08,
      shape: 4,
      shapeCurve: 0.9,
      slide: -2,
      noise: 0.6,
      sustainVolume: 0.5,
      decay: 0.03,
      filter: -450
    })
  }
};

/** Per-stage mining ticks while a block is being broken. */
export const HIT_TICK_SOUNDS: Record<MaterialGroup, SoundDef> = {
  stone: {
    params: zz({
      volume: 0.4,
      randomness: 0.1,
      frequency: 100,
      release: 0.03,
      shape: 4,
      shapeCurve: 1.5,
      noise: 0.8,
      sustainVolume: 0.7,
      decay: 0.01,
      filter: -1200
    }),
    minRetriggerMs: 60
  },
  wood: {
    params: zz({
      volume: 0.35,
      randomness: 0.1,
      frequency: 150,
      release: 0.03,
      shape: 4,
      shapeCurve: 1.2,
      noise: 0.4,
      sustainVolume: 0.7,
      decay: 0.01,
      filter: -800
    }),
    minRetriggerMs: 60
  },
  grass: {
    params: zz({
      volume: 0.3,
      randomness: 0.15,
      frequency: 110,
      release: 0.025,
      shape: 4,
      shapeCurve: 0.8,
      noise: 0.7,
      sustainVolume: 0.6,
      decay: 0.01,
      filter: -500
    }),
    minRetriggerMs: 60
  },
  sand: {
    params: zz({
      volume: 0.25,
      randomness: 0.15,
      frequency: 160,
      release: 0.03,
      shape: 4,
      shapeCurve: 0.6,
      noise: 1,
      sustainVolume: 0.6,
      decay: 0.01,
      filter: 400
    }),
    minRetriggerMs: 60
  },
  glass: { params: zz({ volume: 0.35, randomness: 0.1, frequency: 1200, release: 0.04, shape: 0, sustainVolume: 0.8, decay: 0.01 }), minRetriggerMs: 60 },
  water: {
    params: zz({
      volume: 0.3,
      randomness: 0.15,
      frequency: 200,
      sustain: 0.01,
      release: 0.05,
      shape: 4,
      shapeCurve: 0.9,
      slide: -2,
      noise: 0.6,
      sustainVolume: 0.6,
      decay: 0.02,
      filter: -500
    }),
    minRetriggerMs: 60
  }
};

/** Idle calls, played by the ambience scheduler when the mob is in earshot. */
export const MOB_AMBIENT_SOUNDS: Record<MobKind, SoundDef> = {
  sheep: {
    params: zz({
      volume: 0.6,
      randomness: 0.1,
      frequency: 250,
      attack: 0.03,
      sustain: 0.25,
      release: 0.2,
      shape: 2,
      shapeCurve: 1.5,
      repeatTime: 0.12,
      modulation: 30,
      sustainVolume: 0.8,
      decay: 0.1,
      tremolo: 0.4
    })
  },
  chicken: {
    params: zz({
      volume: 0.5,
      randomness: 0.2,
      frequency: 600,
      sustain: 0.02,
      release: 0.06,
      shape: 0,
      shapeCurve: 1.5,
      pitchJump: 200,
      pitchJumpTime: 0.02,
      delay: 0.04,
      sustainVolume: 0.7,
      decay: 0.02
    })
  },
  horse: {
    params: zz({
      volume: 0.5,
      randomness: 0.1,
      frequency: 100,
      attack: 0.02,
      sustain: 0.1,
      release: 0.15,
      shape: 4,
      shapeCurve: 0.8,
      slide: -1,
      noise: 0.9,
      sustainVolume: 0.6,
      decay: 0.08,
      filter: -300
    })
  },
  zombie: {
    params: zz({
      volume: 0.55,
      randomness: 0.1,
      frequency: 65,
      attack: 0.1,
      sustain: 0.35,
      release: 0.35,
      shape: 2,
      shapeCurve: 1.2,
      slide: -0.5,
      noise: 0.2,
      modulation: 8,
      sustainVolume: 0.8,
      decay: 0.2,
      tremolo: 0.3,
      filter: -200
    })
  },
  skeleton: {
    params: zz({
      volume: 0.45,
      randomness: 0.2,
      frequency: 400,
      sustain: 0.02,
      release: 0.04,
      shape: 4,
      repeatTime: 0.06,
      noise: 0.8,
      sustainVolume: 0.6,
      decay: 0.02,
      filter: 800
    })
  },
  spider: {
    params: zz({
      volume: 0.4,
      randomness: 0.2,
      frequency: 300,
      attack: 0.03,
      sustain: 0.2,
      release: 0.2,
      shape: 4,
      shapeCurve: 0.7,
      noise: 1.3,
      sustainVolume: 0.5,
      decay: 0.1,
      filter: 600
    })
  }
};

/** Played when a mob lands a hit on the player. */
export const MOB_ATTACK_SOUNDS: Record<MobKind, SoundDef> = {
  sheep: {
    params: zz({
      volume: 0.6,
      randomness: 0.1,
      frequency: 90,
      sustain: 0.02,
      release: 0.08,
      shape: 4,
      shapeCurve: 1.2,
      noise: 0.6,
      sustainVolume: 0.7,
      decay: 0.03,
      filter: -500
    }),
    minRetriggerMs: 100
  },
  chicken: {
    params: zz({ volume: 0.5, randomness: 0.2, frequency: 800, sustain: 0.01, release: 0.04, shape: 0, sustainVolume: 0.7, decay: 0.01 }),
    minRetriggerMs: 100
  },
  horse: {
    params: zz({
      volume: 0.7,
      randomness: 0.1,
      frequency: 80,
      sustain: 0.02,
      release: 0.1,
      shape: 4,
      shapeCurve: 1.3,
      noise: 0.7,
      sustainVolume: 0.8,
      decay: 0.04,
      filter: -600
    }),
    minRetriggerMs: 100
  },
  zombie: {
    params: zz({
      volume: 0.8,
      randomness: 0.1,
      frequency: 110,
      sustain: 0.04,
      release: 0.14,
      shape: 4,
      shapeCurve: 1.1,
      slide: -2,
      noise: 0.5,
      sustainVolume: 0.8,
      decay: 0.05,
      filter: -400
    }),
    minRetriggerMs: 100
  },
  skeleton: {
    params: zz({
      volume: 0.6,
      randomness: 0.15,
      frequency: 500,
      sustain: 0.01,
      release: 0.08,
      shape: 4,
      repeatTime: 0.05,
      noise: 0.9,
      sustainVolume: 0.7,
      decay: 0.02,
      filter: 900
    }),
    minRetriggerMs: 100
  },
  spider: {
    params: zz({
      volume: 0.7,
      randomness: 0.15,
      frequency: 250,
      sustain: 0.03,
      release: 0.1,
      shape: 4,
      shapeCurve: 0.8,
      slide: 3,
      noise: 1,
      sustainVolume: 0.7,
      decay: 0.04,
      filter: 500
    }),
    minRetriggerMs: 100
  }
};

/** Soft downward thud when a mob dies and drops its loot. */
export const MOB_DEATH_SOUND: SoundDef = {
  params: zz({
    volume: 0.6,
    randomness: 0.1,
    frequency: 160,
    sustain: 0.03,
    release: 0.16,
    shape: 4,
    shapeCurve: 1.2,
    slide: -5,
    pitchJump: -60,
    pitchJumpTime: 0.05,
    noise: 0.5,
    sustainVolume: 0.7,
    decay: 0.05,
    filter: -500
  }),
  minRetriggerMs: 120
};

/** Thwack when the player's melee attack lands on any mob. */
export const MOB_HIT_SOUND: SoundDef = {
  params: zz({
    volume: 0.7,
    randomness: 0.1,
    frequency: 130,
    sustain: 0.02,
    release: 0.09,
    shape: 4,
    shapeCurve: 1.1,
    slide: -3,
    noise: 0.6,
    sustainVolume: 0.8,
    decay: 0.03,
    filter: -550
  }),
  minRetriggerMs: 100
};

export const JUMP_SOUND: SoundDef = {
  params: zz({ volume: 0.4, frequency: 250, attack: 0.01, sustain: 0.03, release: 0.08, shape: 1, shapeCurve: 1.5, slide: 8 }),
  minRetriggerMs: 150
};

/** Scaled by touchdown speed in the director. */
export const LAND_SOUND: SoundDef = {
  params: zz({
    volume: 0.5,
    randomness: 0.1,
    frequency: 90,
    sustain: 0.02,
    release: 0.07,
    shape: 4,
    shapeCurve: 1.2,
    noise: 0.7,
    sustainVolume: 0.7,
    decay: 0.02,
    filter: -600
  }),
  minRetriggerMs: 150
};

export const HURT_SOUND: SoundDef = {
  params: zz({
    volume: 0.7,
    frequency: 220,
    sustain: 0.04,
    release: 0.12,
    shape: 5,
    shapeCurve: 1.5,
    slide: -8,
    pitchJump: -80,
    pitchJumpTime: 0.06,
    sustainVolume: 0.8,
    decay: 0.04
  }),
  minRetriggerMs: 200
};

export const EAT_SOUND: SoundDef = {
  params: zz({
    volume: 0.5,
    randomness: 0.15,
    frequency: 180,
    sustain: 0.05,
    release: 0.07,
    shape: 4,
    shapeCurve: 0.8,
    repeatTime: 0.09,
    noise: 0.5,
    sustainVolume: 0.7,
    decay: 0.03,
    filter: -350
  }),
  minRetriggerMs: 150
};

export const DEATH_SOUND: SoundDef = {
  params: zz({
    volume: 0.8,
    frequency: 200,
    attack: 0.05,
    sustain: 0.3,
    release: 0.5,
    shape: 1,
    shapeCurve: 1.2,
    slide: -2,
    deltaSlide: -0.5,
    pitchJump: -100,
    pitchJumpTime: 0.15,
    delay: 0.1,
    sustainVolume: 0.8,
    decay: 0.2
  }),
  minRetriggerMs: 500
};

export const RESPAWN_SOUND: SoundDef = {
  params: zz({
    volume: 0.7,
    frequency: 260,
    attack: 0.02,
    sustain: 0.2,
    release: 0.35,
    shape: 1,
    shapeCurve: 1.5,
    pitchJump: 150,
    pitchJumpTime: 0.12,
    delay: 0.08,
    sustainVolume: 0.8,
    decay: 0.15
  }),
  minRetriggerMs: 500
};

/** Soft descending pad as the player drifts off to sleep. */
export const SLEEP_SOUND: SoundDef = {
  params: zz({
    volume: 0.5,
    frequency: 320,
    attack: 0.05,
    sustain: 0.25,
    release: 0.5,
    shape: 1,
    shapeCurve: 1.4,
    slide: -2,
    pitchJump: -120,
    pitchJumpTime: 0.25,
    sustainVolume: 0.7,
    decay: 0.3,
    filter: -700
  }),
  minRetriggerMs: 500
};

/** Gravelly scrape as a hoe tills soil into farmland. */
export const TILL_SOUND: SoundDef = {
  params: zz({
    volume: 0.55,
    randomness: 0.15,
    frequency: 110,
    sustain: 0.03,
    release: 0.1,
    shape: 4,
    shapeCurve: 0.7,
    slide: -1,
    noise: 1.1,
    sustainVolume: 0.6,
    decay: 0.04,
    filter: -350
  }),
  minRetriggerMs: 120
};

/** Soft pop when a seed is planted. */
export const PLANT_SOUND: SoundDef = {
  params: zz({
    volume: 0.4,
    randomness: 0.2,
    frequency: 420,
    sustain: 0.01,
    release: 0.05,
    shape: 0,
    pitchJump: 120,
    pitchJumpTime: 0.02,
    sustainVolume: 0.6,
    decay: 0.02
  }),
  minRetriggerMs: 120
};

/** Soft munch when an animal is fed. */
export const MOB_FED_SOUND: SoundDef = {
  params: zz({
    volume: 0.45,
    randomness: 0.2,
    frequency: 160,
    sustain: 0.04,
    release: 0.07,
    shape: 4,
    shapeCurve: 0.8,
    repeatTime: 0.08,
    noise: 0.4,
    sustainVolume: 0.6,
    decay: 0.03,
    filter: -380
  }),
  minRetriggerMs: 150
};

/** Bright two-note chirp when a baby is born. */
export const MOB_BRED_SOUND: SoundDef = {
  params: zz({
    volume: 0.5,
    randomness: 0.1,
    frequency: 520,
    attack: 0.01,
    sustain: 0.05,
    release: 0.12,
    shape: 1,
    shapeCurve: 1.5,
    pitchJump: 260,
    pitchJumpTime: 0.07,
    sustainVolume: 0.7,
    decay: 0.06
  }),
  minRetriggerMs: 200
};

/** Low crackle when a furnace smelt completes. */
export const SMELT_SOUND: SoundDef = {
  params: zz({
    volume: 0.5,
    randomness: 0.2,
    frequency: 90,
    attack: 0.02,
    sustain: 0.08,
    release: 0.18,
    shape: 4,
    shapeCurve: 1.1,
    noise: 0.8,
    sustainVolume: 0.6,
    decay: 0.08,
    filter: -450
  }),
  minRetriggerMs: 150
};

/** Gentle rising chime on waking — distinct from the brighter respawn stinger. */
export const WAKE_SOUND: SoundDef = {
  params: zz({
    volume: 0.55,
    frequency: 440,
    attack: 0.02,
    sustain: 0.15,
    release: 0.3,
    shape: 1,
    shapeCurve: 1.5,
    pitchJump: 220,
    pitchJumpTime: 0.14,
    repeatTime: 0.1,
    sustainVolume: 0.7,
    decay: 0.12
  }),
  minRetriggerMs: 500
};
