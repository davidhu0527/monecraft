import { BiomeId, BlockId } from "@/lib/world";
import { BREAK_HARDNESS } from "@/lib/game/items";
import type { GameEvent, GameState } from "@/lib/game/engine/state";
import { materialGroupFor } from "./materials";
import {
  ADVANCEMENT_SOUND,
  ARROW_HIT_SOUND,
  BONE_MEAL_SOUND,
  BOSS_ROAR_SOUND,
  BOW_FIRE_SOUND,
  BREAK_SOUNDS,
  FISHING_BITE_SOUND,
  FISHING_CAST_SOUND,
  FISHING_CATCH_SOUND,
  FISHING_REEL_EMPTY_SOUND,
  DEATH_SOUND,
  DRINK_SOUND,
  EAT_SOUND,
  XP_SOUND,
  ENCHANT_SOUND,
  FOOTSTEP_SOUNDS,
  HIT_TICK_SOUNDS,
  HURT_SOUND,
  JUMP_SOUND,
  LAND_SOUND,
  MOB_AMBIENT_SOUNDS,
  MOB_ATTACK_SOUNDS,
  MOB_BRED_SOUND,
  MOB_DEATH_SOUND,
  MOB_FED_SOUND,
  MOB_HIT_SOUND,
  MOB_SPAWN_SOUND,
  PLACE_SOUNDS,
  PLANT_SOUND,
  RESPAWN_SOUND,
  SLEEP_SOUND,
  CHEST_OPEN_SOUND,
  SMELT_SOUND,
  TILL_SOUND,
  VICTORY_SOUND,
  EXPLOSION_SOUND,
  TNT_FUSE_SOUND,
  WAKE_SOUND
} from "./soundParams";
import { createFootstepScheduler } from "./footsteps";
import { createMobAmbienceScheduler } from "./mobAmbience";
import { createMusicBrain, moodFor } from "./musicBrain";
import { createMusicPlayer, type MusicPlayer } from "./musicPlayer";
import { createRainLoop, type RainLoop } from "./rainLoop";
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
  rain: RainLoop;
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
  const rain = createRainLoop(ctx, masterGain);

  return {
    backend,
    music,
    rain,
    setVolumes(master, musicVolume) {
      masterGain.gain.value = master;
      musicGain.gain.value = musicVolume;
    },
    resume() {
      if (ctx.state === "suspended") void ctx.resume();
    },
    dispose() {
      rain.dispose();
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
        case "drankPotion":
          backend.play(DRINK_SOUND);
          break;
        case "xpGained":
          backend.play(XP_SOUND);
          break;
        case "enchanted":
          backend.play(ENCHANT_SOUND);
          break;
        case "advancementUnlocked":
          backend.play(ADVANCEMENT_SOUND);
          break;
        case "anvilCombined":
        case "anvilRepaired":
          backend.play(ENCHANT_SOUND);
          break;
        case "anvilRenamed":
          backend.play(XP_SOUND);
          break;
        case "grindstoneStripped":
          backend.play(XP_SOUND);
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
        case "mobSpawned":
          backend.play(MOB_SPAWN_SOUND);
          break;
        case "bowFired":
          backend.play(BOW_FIRE_SOUND);
          break;
        case "arrowHit":
          backend.play(ARROW_HIT_SOUND);
          break;
        case "bossSummoned":
          backend.play(BOSS_ROAR_SOUND);
          break;
        case "bossDefeated":
          backend.play(VICTORY_SOUND);
          break;
        case "explosion":
          backend.play(EXPLOSION_SOUND);
          break;
        case "tntPrimed":
          backend.play(TNT_FUSE_SOUND);
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
        case "tilledSoil":
          backend.play(TILL_SOUND);
          break;
        case "plantedSeed":
        case "plantedSapling":
          backend.play(PLANT_SOUND);
          break;
        case "usedBoneMeal":
          backend.play(BONE_MEAL_SOUND);
          break;
        case "fishingCast":
          backend.play(FISHING_CAST_SOUND);
          break;
        case "fishingBite":
          backend.play(FISHING_BITE_SOUND);
          break;
        case "fishingCaught":
          backend.play(FISHING_CATCH_SOUND);
          break;
        case "fishingReeledEmpty":
          backend.play(FISHING_REEL_EMPTY_SOUND);
          break;
        case "smelted":
          backend.play(SMELT_SOUND);
          break;
        case "openedContainer":
          backend.play(CHEST_OPEN_SOUND);
          break;
        case "doorToggled":
          backend.play(PLACE_SOUNDS.wood, { gain: event.open ? 0.8 : 1 });
          break;
        case "mobFed":
          backend.play(MOB_FED_SOUND);
          break;
        case "mobBred":
          backend.play(MOB_BRED_SOUND);
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

      // Rain bed follows rain intensity; snow is silent, and it goes quiet on pause.
      graph.rain.setIntensity(!state.paused && state.weather.kind === "rain" ? state.weather.intensity : 0);

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
