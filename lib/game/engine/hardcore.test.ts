import { describe, expect, test } from "bun:test";
import { GameEngine } from "@/lib/game/engine/GameEngine";
import type { GameEvent } from "@/lib/game/engine/state";

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeEngine(opts: { hardcore?: boolean } = {}): GameEngine {
  return new GameEngine({ seed: 1337, rng: mulberry32(42), worldSize: { x: 64, y: 150, z: 64 }, ...opts });
}

// The lethal seams are private arrow methods; poke them directly for a clean kill.
type DamageHooks = {
  applyDamage: (amount: number) => void;
  applyEnvironmentalDamage: (amount: number) => void;
  applyPoisonDamage: (amount: number) => void;
};
const hooks = (e: GameEngine) => e as unknown as DamageHooks;
const hasEvent = (events: GameEvent[], type: GameEvent["type"]) => events.some((ev) => ev.type === type);

describe("hardcore forcing & locks", () => {
  test("forces Hard + Survival, overriding the requested mode/difficulty", () => {
    const e = new GameEngine({
      seed: 1,
      rng: mulberry32(1),
      worldSize: { x: 64, y: 150, z: 64 },
      hardcore: true,
      difficulty: "peaceful",
      gameMode: "creative"
    });
    expect(e.state.hardcore).toBe(true);
    expect(e.state.difficulty).toBe("hard");
    expect(e.state.gameMode).toBe("survival");
  });

  test("setDifficulty and setGameMode are no-ops in a hardcore world", () => {
    const e = makeEngine({ hardcore: true });
    e.dispatch({ type: "setDifficulty", difficulty: "easy" });
    e.dispatch({ type: "setGameMode", mode: "creative" });
    expect(e.state.difficulty).toBe("hard");
    expect(e.state.gameMode).toBe("survival");
  });

  test("a normal world still honours both switches (the guards are hardcore-scoped)", () => {
    const e = makeEngine({ hardcore: false });
    e.dispatch({ type: "setDifficulty", difficulty: "easy" });
    e.dispatch({ type: "setGameMode", mode: "creative" });
    expect(e.state.difficulty).toBe("easy");
    expect(e.state.gameMode).toBe("creative");
  });
});

describe("hardcore permadeath", () => {
  test("a lethal hit ends the run: spectator game-over, no respawn, gameOver event", () => {
    const e = makeEngine({ hardcore: true });
    e.state.hearts = 4;
    hooks(e).applyDamage(100);

    expect(e.state.gameOver).toBe(true);
    expect(e.state.gameMode).toBe("spectator");
    expect(e.state.isFlying).toBe(true);
    expect(e.state.isDead).toBe(false); // no respawn countdown — the run is over
    expect(e.state.respawnTimer).toBe(0);
    expect(e.state.hearts).toBe(0);
    const events = e.consumeEvents();
    expect(hasEvent(events, "gameOver")).toBe(true);
    expect(hasEvent(events, "died")).toBe(false);
  });

  test("a normal world's lethal hit still respawns (died, not game-over)", () => {
    const e = makeEngine({ hardcore: false });
    e.state.hearts = 4;
    hooks(e).applyDamage(100);

    expect(e.state.isDead).toBe(true);
    expect(e.state.gameOver).toBe(false);
    const events = e.consumeEvents();
    expect(hasEvent(events, "died")).toBe(true);
    expect(hasEvent(events, "gameOver")).toBe(false);
  });

  test("environmental lethal damage also ends the run", () => {
    const e = makeEngine({ hardcore: true });
    e.state.hearts = 2;
    hooks(e).applyEnvironmentalDamage(100);
    expect(e.state.gameOver).toBe(true);
    expect(e.state.gameMode).toBe("spectator");
  });

  test("poison can never end the run (it floors above zero)", () => {
    const e = makeEngine({ hardcore: true });
    e.state.hearts = 1;
    for (let i = 0; i < 10; i += 1) hooks(e).applyPoisonDamage(100);
    expect(e.state.gameOver).toBe(false);
    expect(e.state.hearts).toBeGreaterThan(0);
  });

  test("after game-over the spectator is inert: more damage does nothing and fires no second event", () => {
    const e = makeEngine({ hardcore: true });
    e.state.hearts = 1;
    hooks(e).applyDamage(100);
    e.consumeEvents(); // drain the first gameOver
    hooks(e).applyDamage(100);
    hooks(e).applyEnvironmentalDamage(100);
    expect(e.state.hearts).toBe(0);
    expect(hasEvent(e.consumeEvents(), "gameOver")).toBe(false);
  });
});

describe("hardcore persistence", () => {
  test("a dead hardcore world reloads into the spectator game-over state", () => {
    const e = makeEngine({ hardcore: true });
    e.state.hearts = 1;
    hooks(e).applyDamage(100);
    const save = e.serialize();
    expect(save.version).toBe(10);
    expect(save.hardcore).toBe(true);
    expect(save.gameOver).toBe(true);

    const restored = new GameEngine({ save, rng: mulberry32(1), worldSize: { x: 64, y: 150, z: 64 } });
    expect(restored.state.hardcore).toBe(true);
    expect(restored.state.gameOver).toBe(true);
    expect(restored.state.gameMode).toBe("spectator");
    expect(restored.state.isFlying).toBe(true);
    expect(restored.state.isDead).toBe(false);
    expect(restored.state.difficulty).toBe("hard");
    const snap = restored.getSnapshot();
    expect(snap.gameOver).toBe(true);
    expect(snap.respawnSeconds).toBe(0); // never the respawn death screen
  });

  test("a live (not-yet-dead) hardcore world round-trips as playable survival+hard", () => {
    const e = makeEngine({ hardcore: true });
    const restored = new GameEngine({ save: e.serialize(), rng: mulberry32(1), worldSize: { x: 64, y: 150, z: 64 } });
    expect(restored.state.hardcore).toBe(true);
    expect(restored.state.gameOver).toBe(false);
    expect(restored.state.gameMode).toBe("survival");
    expect(restored.state.difficulty).toBe("hard");
  });
});
