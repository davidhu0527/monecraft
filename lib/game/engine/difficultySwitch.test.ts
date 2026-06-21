import { describe, expect, test } from "bun:test";
import { GameEngine } from "@/lib/game/engine/GameEngine";
import { pushMob } from "@/lib/game/engine/systems/spawnDirector";
import type { Difficulty } from "@/lib/game/difficulties";

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeEngine(difficulty: Difficulty): GameEngine {
  return new GameEngine({ seed: 1337, difficulty, rng: mulberry32(42), worldSize: { x: 64, y: 150, z: 64 } });
}

/**
 * Replaces the constructor's initial spawn with a fixed mix of two hostiles and
 * two passives near the player, so the assertions count exactly what we seeded.
 */
function seedMobs(e: GameEngine): void {
  e.state.mobs = [];
  const { x, y, z } = e.state.player.position;
  const rng = mulberry32(7);
  pushMob(e.state, "zombie", true, x + 4, y, z, rng);
  pushMob(e.state, "skeleton", true, x - 4, y, z + 2, rng);
  pushMob(e.state, "sheep", false, x + 2, y, z - 3, rng);
  pushMob(e.state, "cow", false, x - 2, y, z + 3, rng);
}

describe("setDifficulty", () => {
  test("switching to Peaceful despawns every hostile but keeps passives", () => {
    const e = makeEngine("normal");
    seedMobs(e);
    expect(e.state.mobs.some((m) => m.hostile)).toBe(true);

    e.dispatch({ type: "setDifficulty", difficulty: "peaceful" });

    expect(e.state.difficulty).toBe("peaceful");
    expect(e.state.mobs.some((m) => m.hostile)).toBe(false);
    expect(e.state.mobs.filter((m) => !m.hostile)).toHaveLength(2); // sheep + cow survive
  });

  test("the Peaceful despawn rewards nothing and never counts as a boss victory", () => {
    const e = makeEngine("hard");
    e.state.mobs = [];
    const rng = mulberry32(7);
    const { x, y, z } = e.state.player.position;
    pushMob(e.state, "boss", true, x + 5, y, z, rng);
    pushMob(e.state, "zombie", true, x - 5, y, z, rng);
    const xpBefore = e.state.xp;

    e.dispatch({ type: "setDifficulty", difficulty: "peaceful" });

    expect(e.state.mobs).toHaveLength(0);
    expect(e.state.victory).toBe(false); // despawning the boss is not defeating it
    expect(e.state.xp).toBe(xpBefore); // no kill XP for a despawn
  });

  test("a same-difficulty switch is a no-op that leaves hostiles alone", () => {
    const e = makeEngine("normal");
    seedMobs(e);
    e.dispatch({ type: "setDifficulty", difficulty: "normal" });
    expect(e.state.mobs.some((m) => m.hostile)).toBe(true); // untouched
  });

  test("raising Peaceful → Hard sets the level without instantly spawning a horde", () => {
    const e = makeEngine("peaceful");
    e.state.mobs = [];
    e.dispatch({ type: "setDifficulty", difficulty: "hard" });
    expect(e.state.difficulty).toBe("hard");
    expect(e.state.mobs.filter((m) => m.hostile)).toHaveLength(0); // the switch itself spawns nothing; directors trickle later
  });

  test("the switched difficulty persists through serialize/restore", () => {
    const e = makeEngine("normal");
    e.dispatch({ type: "setDifficulty", difficulty: "easy" });
    const restored = new GameEngine({ save: e.serialize(), rng: mulberry32(1), worldSize: { x: 64, y: 150, z: 64 } });
    expect(restored.state.difficulty).toBe("easy");
  });
});
