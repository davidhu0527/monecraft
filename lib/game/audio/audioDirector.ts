import { BiomeId, BlockId } from "@/lib/world";
import { BREAK_HARDNESS } from "@/lib/game/items";
import type { GameEvent, GameState } from "@/lib/game/engine/state";
import { materialGroupFor } from "./materials";
import {
  BREAK_SOUNDS,
  DEATH_SOUND,
  EAT_SOUND,
  FOOTSTEP_SOUNDS,
  HIT_TICK_SOUNDS,
  HURT_SOUND,
  JUMP_SOUND,
  LAND_SOUND,
  MOB_AMBIENT_SOUNDS,
  MOB_ATTACK_SOUNDS,
  MOB_DEATH_SOUND,
  MOB_HIT_SOUND,
  PLACE_SOUNDS,
  RESPAWN_SOUND,
  SLEEP_SOUND,
  WAKE_SOUND
} from "./soundParams";
import { createFootstepScheduler } from "./footsteps";
import { createMobAmbienceScheduler } from "./mobAmbience";
import { createMusicBrain, moodFor } from "./musicBrain";
import { createMusicPlayer, type MusicPlayer } from "./musicPlayer";
import { createSynthBackend, type SynthBackend } from "./synth";

export type AudioSettings = {
  /** 0..1 — everything. */
  master: number;
  /** 0..1 — the ambient pad only, under master. */
  music: number;
  muted: boolean;
};

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { master: 0.8, music: 0.6, muted: false };

/** The live WebAudio half, created lazily on unlock(). Injectable for tests. */
export type AudioGraph = {
  backend: SynthBackend;
  music: MusicPlayer;
  setVolumes(master: number, music: number): void;
  resume(): void;
  dispose(): void;
};

export type AudioDirector = {
  /** Builds/resumes the AudioContext. Must be called from a user gesture. */
  unlock(): void;
  handleEvent(event: GameEvent): void;
  /** Per-frame, after the engine step — drives all continuous sound. */
  sync(state: GameState, dt: number): void;
  setSettings(settings: AudioSettings): void;
  dispose(): void;
};

/** Mining ticks per block — one per crack-overlay-ish stage. */
const MINING_TICK_STAGES = 4;
/** Touchdown speed that plays the landing thud at full volume. */
const FULL_LANDING_IMPACT = 12;
/** Seconds a newly entered biome must persist before the music follows it. */
const BIOME_HYSTERESIS_SECONDS = 5;
/** Music runs at quarter volume behind the pause menu. */
const PAUSE_DUCK = 0.25;

/** The production graph: zzfx + AudioContext, imported only inside a gesture. */
async function createDefaultGraph(): Promise<AudioGraph> {
  // zzfx instantiates its own module-scope AudioContext on import, so the
  // import itself must wait for the unlock gesture (autoplay policy, SSR).
  const { ZZFX } = await import("zzfx");
  const ctx = new AudioContext();
  const compressor = ctx.createDynamicsCompressor();
  compressor.connect(ctx.destination);
  const masterGain = ctx.createGain();
  masterGain.connect(compressor);
  const sfxGain = ctx.createGain();
  sfxGain.connect(masterGain);
  const musicGain = ctx.createGain();
  musicGain.connect(masterGain);

  const backend = createSynthBackend(ctx, sfxGain, (...params) => ZZFX.buildSamples(...params), ZZFX.sampleRate);
  const music = createMusicPlayer(ctx, musicGain, createMusicBrain());

  return {
    backend,
    music,
    setVolumes(master, musicVolume) {
      masterGain.gain.value = master;
      musicGain.gain.value = musicVolume;
    },
    resume() {
      if (ctx.state === "suspended") void ctx.resume();
    },
    dispose() {
      music.dispose();
      backend.dispose();
      void ctx.close();
    }
  };
}

export type AudioDirectorDeps = {
  createGraph?: () => Promise<AudioGraph> | AudioGraph;
  rng?: () => number;
};

export function createAudioDirector(deps: AudioDirectorDeps = {}): AudioDirector {
  const createGraph = deps.createGraph ?? createDefaultGraph;
  const footsteps = createFootstepScheduler();
  const mobAmbience = createMobAmbienceScheduler(deps.rng);

  let graph: AudioGraph | null = null;
  let unlocking = false;
  let disposed = false;
  let settings = DEFAULT_AUDIO_SETTINGS;

  // Continuous-sound trackers, all derived from state in sync().
  let lastX = 0;
  let lastZ = 0;
  let hasLastPosition = false;
  let miningKey = "";
  let miningStage = 0;
  let miningTickSound = HIT_TICK_SOUNDS.stone;
  let miningHardness = 2;
  let stableBiome = BiomeId.Plains;
  let pendingBiome = BiomeId.Plains;
  let pendingBiomeSeconds = 0;
  let ducked = false;

  const applyVolumes = (): void => {
    graph?.setVolumes(settings.muted ? 0 : settings.master, (ducked ? PAUSE_DUCK : 1) * settings.music);
  };

  const surfaceGroupUnder = (state: GameState, fx: number, fy: number, fz: number) => {
    let block = state.world.get(fx, fy - 1, fz) as BlockId;
    if (block === BlockId.Air) block = state.world.get(fx, fy - 2, fz) as BlockId;
    return materialGroupFor(block);
  };

  return {
    unlock() {
      if (disposed || graph || unlocking) {
        graph?.resume();
        return;
      }
      unlocking = true;
      void Promise.resolve(createGraph())
        .then((created) => {
          if (disposed) {
            created.dispose();
            return;
          }
          graph = created;
          // The constructor gesture may have expired by this microtask —
          // resume explicitly so the context reliably leaves "suspended".
          created.resume();
          applyVolumes();
        })
        .catch(() => {
          // Audio stays optional; the next gesture retries from scratch.
        })
        .finally(() => {
          unlocking = false;
        });
    },

    handleEvent(event) {
      const backend = graph?.backend;
      if (!backend) return;
      switch (event.type) {
        case "blockBroken":
          backend.play(BREAK_SOUNDS[materialGroupFor(event.blockId)]);
          break;
        case "blockPlaced":
          backend.play(PLACE_SOUNDS[materialGroupFor(event.blockId)]);
          break;
        case "playerHurt":
          backend.play(HURT_SOUND);
          break;
        case "ateFood":
          backend.play(EAT_SOUND);
          break;
        case "jumped":
          backend.play(JUMP_SOUND);
          break;
        case "landed":
          backend.play(LAND_SOUND, { gain: Math.min(1.2, Math.max(0.3, event.impact / FULL_LANDING_IMPACT)) });
          break;
        case "mobAttacked":
          backend.play(MOB_ATTACK_SOUNDS[event.kind]);
          break;
        case "mobHit":
          backend.play(MOB_HIT_SOUND);
          break;
        case "mobDied":
          backend.play(MOB_DEATH_SOUND);
          break;
        case "died":
          backend.play(DEATH_SOUND);
          break;
        case "respawned":
          backend.play(RESPAWN_SOUND);
          break;
        case "sleepStarted":
          backend.play(SLEEP_SOUND);
          break;
        case "wokeUp":
          backend.play(WAKE_SOUND);
          break;
      }
    },

    sync(state, dt) {
      if (!graph) return;
      const { player, world } = state;
      const fx = Math.floor(player.position.x);
      const fy = Math.floor(player.position.y);
      const fz = Math.floor(player.position.z);

      // Footsteps from actual movement deltas (knockback and walking alike).
      if (!hasLastPosition) {
        lastX = player.position.x;
        lastZ = player.position.z;
        hasLastPosition = true;
      }
      const dx = player.position.x - lastX;
      const dz = player.position.z - lastZ;
      lastX = player.position.x;
      lastZ = player.position.z;
      if (!state.paused && !state.isDead && footsteps.tick(player.onGround, dx, dz)) {
        graph.backend.play(FOOTSTEP_SOUNDS[surfaceGroupUnder(state, fx, fy, fz)]);
      }

      // Mining hit ticks: one per quarter of the block's hardness.
      if (state.mining.targetKey !== miningKey) {
        miningKey = state.mining.targetKey;
        miningStage = 0;
        if (miningKey) {
          const [bx, by, bz] = miningKey.split(",").map(Number);
          const block = world.get(bx, by, bz) as BlockId;
          miningTickSound = HIT_TICK_SOUNDS[materialGroupFor(block)];
          miningHardness = BREAK_HARDNESS[block] ?? 2;
        }
      }
      if (miningKey && state.mining.progress < miningHardness) {
        const stage = Math.floor((state.mining.progress / miningHardness) * MINING_TICK_STAGES);
        if (stage > miningStage) {
          miningStage = stage;
          graph.backend.play(miningTickSound);
        }
      }

      // Mob ambience, frozen with the simulation while paused.
      if (!state.paused) {
        const calls = mobAmbience.tick(dt, state.mobs, player.position.x, player.position.z, player.yaw);
        for (const call of calls) {
          graph.backend.play(MOB_AMBIENT_SOUNDS[call.kind], { gain: call.gain, pan: call.pan });
        }
      }

      // Music follows daylight immediately and the biome with hysteresis, so
      // zigzagging a chunk border doesn't whipsaw the mood.
      const biomeHere = world.getBiome(fx, fz);
      if (biomeHere === stableBiome) {
        pendingBiomeSeconds = 0;
      } else if (biomeHere === pendingBiome) {
        pendingBiomeSeconds += dt;
        if (pendingBiomeSeconds >= BIOME_HYSTERESIS_SECONDS) stableBiome = biomeHere;
      } else {
        pendingBiome = biomeHere;
        pendingBiomeSeconds = 0;
      }
      graph.music.sync(dt, moodFor(state.daylight, stableBiome));

      if (ducked !== state.paused) {
        ducked = state.paused;
        applyVolumes();
      }
    },

    setSettings(next) {
      settings = next;
      applyVolumes();
    },

    dispose() {
      disposed = true;
      graph?.dispose();
      graph = null;
    }
  };
}
