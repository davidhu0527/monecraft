import { describe, expect, test } from "bun:test";
import { BlockId, collidesAt } from "@/lib/world";
import { MAX_HEARTS, PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from "@/lib/game/config";
import { GameEngine } from "@/lib/game/engine/GameEngine";
import type { GameMode } from "@/lib/game/gameModes";

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeEngine(gameMode: GameMode): GameEngine {
  return new GameEngine({ seed: 1337, gameMode, rng: mulberry32(42), worldSize: { x: 64, y: 150, z: 64 } });
}

describe("setGameMode", () => {
  test("switches mode and clears queued hazard damage + refills bars", () => {
    const e = makeEngine("survival");
    e.state.hearts = 4;
    e.state.timers.lavaBurnTimer = 2;
    e.state.timers.drownTimer = 1;

    e.dispatch({ type: "setGameMode", mode: "creative" });

    expect(e.state.gameMode).toBe("creative");
    expect(e.state.hearts).toBe(MAX_HEARTS);
    expect(e.state.timers.lavaBurnTimer).toBe(0);
    expect(e.state.timers.drownTimer).toBe(0);
    expect(e.state.isFlying).toBe(false);
  });

  test("entering spectator forces flight; leaving it grounds the player", () => {
    const e = makeEngine("survival");
    e.dispatch({ type: "setGameMode", mode: "spectator" });
    expect(e.state.isFlying).toBe(true);
    e.dispatch({ type: "setGameMode", mode: "adventure" });
    expect(e.state.isFlying).toBe(false);
  });

  test("a same-mode switch is a no-op", () => {
    const e = makeEngine("creative");
    e.state.isFlying = true;
    e.dispatch({ type: "setGameMode", mode: "creative" });
    expect(e.state.isFlying).toBe(true); // untouched — not reset to false
  });

  test("leaving spectator lifts the player out of solid terrain", () => {
    const e = makeEngine("spectator");
    const p = e.state.player.position;
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    const pz = Math.floor(p.z);
    // Bury the player in stone (legal while noclipping).
    for (let dx = -1; dx <= 1; dx += 1)
      for (let dy = 0; dy <= 2; dy += 1) for (let dz = -1; dz <= 1; dz += 1) e.state.blockChanges.set(px + dx, py + dy, pz + dz, BlockId.Stone);
    expect(collidesAt(e.state.world, e.state.player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT)).toBe(true);

    e.dispatch({ type: "setGameMode", mode: "survival" });

    expect(collidesAt(e.state.world, e.state.player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT)).toBe(false);
  });

  test("the switched mode persists through serialize/restore", () => {
    const e = makeEngine("survival");
    e.dispatch({ type: "setGameMode", mode: "creative" });
    const restored = new GameEngine({ save: e.serialize(), rng: mulberry32(1), worldSize: { x: 64, y: 150, z: 64 } });
    expect(restored.state.gameMode).toBe("creative");
  });
});
