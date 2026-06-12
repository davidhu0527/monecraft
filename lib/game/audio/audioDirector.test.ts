import { describe, expect, test } from "bun:test";
import { GameEngine } from "@/lib/game/engine/GameEngine";
import type { FrameInput } from "@/lib/game/engine/state";
import { createAudioDirector, DEFAULT_AUDIO_SETTINGS, type AudioGraph } from "./audioDirector";
import type { MusicMood } from "./musicBrain";
import type { PlayOptions, SynthBackend } from "./synth";
import { BREAK_SOUNDS, HIT_TICK_SOUNDS, HURT_SOUND, JUMP_SOUND, LAND_SOUND, PLACE_SOUNDS, FOOTSTEP_SOUNDS, type SoundDef } from "./soundParams";
import { BlockId } from "@/lib/world";

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

type Played = { def: SoundDef; opts: PlayOptions };

function createFakeGraph() {
  const played: Played[] = [];
  const volumes: Array<{ master: number; music: number }> = [];
  const moods: MusicMood[] = [];
  let clock = 0;
  const backend: SynthBackend = {
    now: () => clock,
    play: (def, opts = {}) => {
      played.push({ def, opts });
    },
    dispose: () => {}
  };
  const graph: AudioGraph = {
    backend,
    music: {
      sync: (dt, mood) => {
        clock += dt;
        moods.push(mood);
      },
      dispose: () => {}
    },
    setVolumes: (master, music) => {
      volumes.push({ master, music });
    },
    resume: () => {},
    dispose: () => {}
  };
  return { graph, played, volumes, moods };
}

async function createUnlockedDirector() {
  const fake = createFakeGraph();
  const director = createAudioDirector({ createGraph: () => fake.graph, rng: mulberry32(7) });
  director.unlock();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { director, ...fake };
}

function makeEngine(): GameEngine {
  return new GameEngine({ seed: 1337, rng: mulberry32(42), worldSize: { x: 64, y: 150, z: 64 } });
}

function input(overrides: Partial<{ keys: string[]; leftMouseHeld: boolean; pointerLocked: boolean }> = {}): FrameInput {
  return {
    keys: new Set(overrides.keys ?? []),
    capsActive: false,
    leftMouseHeld: overrides.leftMouseHeld ?? false,
    pointerLocked: overrides.pointerLocked ?? false
  };
}

/** Steps the engine while piping events and state to the director, like the shell loop. */
function runWired(
  engine: GameEngine,
  director: Awaited<ReturnType<typeof createUnlockedDirector>>["director"],
  seconds: number,
  frame: FrameInput = input()
): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    engine.step(dt, frame);
    for (const event of engine.consumeEvents()) director.handleEvent(event);
    director.sync(engine.state, dt);
  }
}

function calmDaytime(engine: GameEngine): void {
  engine.state.mobs = engine.state.mobs.filter((mob) => !mob.hostile);
  engine.state.dayClock = 60;
}

describe("audio director", () => {
  test("does nothing before unlock", () => {
    const fake = createFakeGraph();
    const director = createAudioDirector({ createGraph: () => fake.graph });
    director.handleEvent({ type: "blockBroken", blockId: BlockId.Stone });
    expect(fake.played.length).toBe(0);
  });

  test("routes block events through the material mapping", async () => {
    const { director, played } = await createUnlockedDirector();
    director.handleEvent({ type: "blockBroken", blockId: BlockId.Cobblestone });
    director.handleEvent({ type: "blockPlaced", blockId: BlockId.Planks });
    director.handleEvent({ type: "playerHurt" });
    expect(played[0].def).toBe(BREAK_SOUNDS.stone);
    expect(played[1].def).toBe(PLACE_SOUNDS.wood);
    expect(played[2].def).toBe(HURT_SOUND);
  });

  test("landing volume scales with impact", async () => {
    const { director, played } = await createUnlockedDirector();
    director.handleEvent({ type: "landed", impact: 3 });
    director.handleEvent({ type: "landed", impact: 20 });
    expect(played[0].def).toBe(LAND_SOUND);
    expect(played[0].opts.gain!).toBeLessThan(played[1].opts.gain!);
  });

  test("walking produces footsteps and jumping produces the jump blip", async () => {
    const { director, played } = await createUnlockedDirector();
    const engine = makeEngine();
    calmDaytime(engine);
    runWired(engine, director, 1); // settle
    played.length = 0;
    runWired(engine, director, 3, input({ keys: ["KeyW"] }));
    const footsteps = Object.values(FOOTSTEP_SOUNDS);
    expect(played.some((p) => footsteps.includes(p.def))).toBe(true);
    runWired(engine, director, 0.1, input({ keys: ["Space"] }));
    expect(played.some((p) => p.def === JUMP_SOUND)).toBe(true);
  });

  test("mining a block emits staged hit ticks and then the break sound", async () => {
    const { director, played } = await createUnlockedDirector();
    const engine = makeEngine();
    calmDaytime(engine);
    runWired(engine, director, 1);
    const { state } = engine;
    const px = Math.floor(state.player.position.x);
    const pz = Math.floor(state.player.position.z);
    state.player.position.x = px + 0.5;
    state.player.position.z = pz + 0.5;
    state.player.pitch = -Math.PI / 2 + 0.02;
    played.length = 0;
    runWired(engine, director, 4, input({ leftMouseHeld: true, pointerLocked: true }));
    const ticks = Object.values(HIT_TICK_SOUNDS);
    const breaks = Object.values(BREAK_SOUNDS);
    expect(played.filter((p) => ticks.includes(p.def)).length).toBeGreaterThanOrEqual(2);
    expect(played.some((p) => breaks.includes(p.def))).toBe(true);
  });

  test("pausing ducks the music and resuming restores it", async () => {
    const { director, volumes, moods } = await createUnlockedDirector();
    const engine = makeEngine();
    calmDaytime(engine);
    director.setSettings({ ...DEFAULT_AUDIO_SETTINGS, master: 1, music: 0.8 });
    runWired(engine, director, 0.2);
    expect(moods.length).toBeGreaterThan(0);
    volumes.length = 0;
    engine.dispatch({ type: "pause" });
    runWired(engine, director, 0.1);
    expect(volumes[0].music).toBeCloseTo(0.8 * 0.25, 5);
    engine.dispatch({ type: "resume" });
    runWired(engine, director, 0.1);
    expect(volumes[volumes.length - 1].music).toBeCloseTo(0.8, 5);
  });

  test("repeated gestures resume the existing graph instead of rebuilding it", async () => {
    const fake = createFakeGraph();
    let creations = 0;
    const director = createAudioDirector({
      createGraph: () => {
        creations += 1;
        return fake.graph;
      }
    });
    director.unlock();
    await new Promise((resolve) => setTimeout(resolve, 0));
    director.unlock();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(creations).toBe(1);
  });

  test("a failed graph creation is retried on the next gesture", async () => {
    const fake = createFakeGraph();
    let attempts = 0;
    const director = createAudioDirector({
      createGraph: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error("no audio")) : fake.graph;
      }
    });
    director.unlock();
    await new Promise((resolve) => setTimeout(resolve, 0));
    director.handleEvent({ type: "playerHurt" });
    expect(fake.played.length).toBe(0);
    director.unlock();
    await new Promise((resolve) => setTimeout(resolve, 0));
    director.handleEvent({ type: "playerHurt" });
    expect(fake.played.length).toBe(1);
    expect(attempts).toBe(2);
  });

  test("mute zeroes the master volume", async () => {
    const { director, volumes } = await createUnlockedDirector();
    director.setSettings({ master: 0.9, music: 0.5, muted: true });
    expect(volumes[volumes.length - 1].master).toBe(0);
  });
});
