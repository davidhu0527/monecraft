import { mobsThreaten } from "@/lib/game/gameModes";
import type { GameState, PlayerId, PlayerState, PlayerTimers, WorldTimers } from "./state";

/**
 * The players map and the legacy alias layer.
 *
 * GameState.players holds one PlayerState per player; single-player is the
 * one-entry case. The flat fields the codebase grew up with (`state.player`,
 * `state.inventory`, `state.hearts`, …) remain available as accessor
 * properties that delegate to the PRIMARY player — installed here — so the
 * React shell, the Playwright suite (window.__monecraft), and existing tests
 * keep working unchanged.
 *
 * The aliases are a permanent convenience for the single-player shell, NOT a
 * transition shim — but ENGINE SYSTEMS MUST NOT USE THEM: a system that reads
 * `state.player` silently acts on "whoever is primary", which is wrong on a
 * server. Systems take the acting PlayerState explicitly.
 */

/** GameState keys aliased 1:1 onto the primary PlayerState (same name, same type). */
const PLAYER_ALIAS_KEYS = [
  "inventory",
  "equippedArmor",
  "selectedSlot",
  "gameMode",
  "isFlying",
  "gameOver",
  "hearts",
  "hunger",
  "oxygen",
  "effects",
  "xp",
  "stats",
  "advancements",
  "isDead",
  "respawnTimer",
  "spawnPoint",
  "mining",
  "fishing",
  "mountedVehicleId",
  "inventoryOpen",
  "advancementsOpen",
  "craftingStation",
  "activeVillagerProfession",
  "openContainerIndex"
] as const satisfies ReadonlyArray<keyof PlayerState & keyof GameState>;

/** PlayerTimers keys aliased onto state.timers (world timers stay real properties there). */
const PLAYER_TIMER_KEYS = [
  "voidTimer",
  "regenTimer",
  "waterExposureTimer",
  "waterDamageTimer",
  "lavaBurnTimer",
  "lavaDamageTimer",
  "drownTimer",
  "starvationTimer",
  "sprintDistanceBudget",
  "walkDistanceBudget",
  "jumpBudget",
  "effectRegenTimer",
  "effectPoisonTimer",
  "stuckTimer",
  "spearThrowCooldown",
  "bowCooldownTimer"
] as const satisfies ReadonlyArray<keyof PlayerTimers>;

export function getPlayer(state: GameState, id: PlayerId): PlayerState | undefined {
  return state.players.get(id);
}

export function mustGetPlayer(state: GameState, id: PlayerId): PlayerState {
  const player = state.players.get(id);
  if (!player) throw new Error(`Unknown player id: ${id}`);
  return player;
}

export function primaryPlayer(state: GameState): PlayerState {
  return mustGetPlayer(state, state.primaryPlayerId);
}

/**
 * Nearest player (any mode) to a world XZ position, or null with no players.
 * The proximity anchor for flee/follow/interest behavior. Single-player: the
 * one player — exactly the old `state.player` reads.
 */
export function nearestPlayerTo(state: GameState, x: number, z: number): PlayerState | null {
  let best: PlayerState | null = null;
  let bestSq = Infinity;
  for (const player of state.players.values()) {
    const dx = player.position.x - x;
    const dz = player.position.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestSq) {
      bestSq = d;
      best = player;
    }
  }
  return best;
}

/**
 * True when every player who COULD sleep is in bed — the gate for the sleep
 * fade. Dead players and spectators don't count against the night skip (a
 * spectator can't reach a bed; a dead player is about to respawn anyway).
 * Single-player: the one player climbing into bed satisfies it immediately.
 */
export function allEligiblePlayersSleeping(state: GameState): boolean {
  let sleepers = 0;
  for (const player of state.players.values()) {
    if (player.isDead || player.gameMode === "spectator") continue;
    if (!player.sleeping) return false;
    sleepers += 1;
  }
  return sleepers > 0;
}

/**
 * Nearest player hostiles may hunt — Creative/Spectator players aren't a
 * threat target (mobsThreaten), so they're skipped. Null when nobody is
 * huntable (or the world is empty, e.g. an idle server room).
 */
export function nearestTargetablePlayer(state: GameState, x: number, z: number): PlayerState | null {
  let best: PlayerState | null = null;
  let bestSq = Infinity;
  for (const player of state.players.values()) {
    if (player.isDead) continue; // don't let mobs hunt a corpse over nearby live players
    if (!mobsThreaten(player.gameMode)) continue;
    const dx = player.position.x - x;
    const dz = player.position.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestSq) {
      bestSq = d;
      best = player;
    }
  }
  return best;
}

/**
 * The world-level fields of GameState — what the engine constructor actually
 * builds as data. The per-player flat fields (plus `player` and the player
 * half of `timers`) are installed as accessors by installPlayerAliases.
 */
export type GameStateBase = Omit<GameState, (typeof PLAYER_ALIAS_KEYS)[number] | "player" | "timers"> & {
  timers: WorldTimers;
};

/**
 * Installs the primary-player accessor aliases onto a base state and returns
 * it as the full GameState. `state.timers` is augmented in place: world timers
 * remain data properties, player timers become accessors onto the primary
 * player's PlayerTimers.
 */
export function installPlayerAliases(base: GameStateBase): GameState {
  const state = base as unknown as GameState;

  Object.defineProperty(state, "player", {
    get: () => primaryPlayer(state),
    enumerable: true,
    configurable: true
  });

  for (const key of PLAYER_ALIAS_KEYS) {
    Object.defineProperty(state, key, {
      get: () => primaryPlayer(state)[key],
      set: (value) => {
        (primaryPlayer(state) as Record<typeof key, unknown>)[key] = value;
      },
      enumerable: true,
      configurable: true
    });
  }

  for (const key of PLAYER_TIMER_KEYS) {
    Object.defineProperty(state.timers, key, {
      get: () => primaryPlayer(state).timers[key],
      set: (value: number) => {
        primaryPlayer(state).timers[key] = value;
      },
      enumerable: true,
      configurable: true
    });
  }

  return state;
}
