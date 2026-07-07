import * as THREE from "three";
import { BlockId } from "@/lib/world";
import { GEN } from "@/lib/world/generation";
import {
  AQUATIC_CAP,
  AQUATIC_SPAWN_INTERVAL_SECONDS,
  BOSS_SUMMON_INTERVAL_SECONDS,
  DROWNED_CAP,
  DROWNED_SPAWN_MIN_RADIUS,
  HOSTILE_CAP,
  HOSTILE_SPAWN_BELOW_DAYLIGHT,
  HOSTILE_SPAWN_INTERVAL_SECONDS,
  HOSTILE_SPAWN_MIN_RADIUS,
  RENDER_RADIUS,
  SPAWNER_ACTIVATION_RADIUS,
  SPAWNER_INTERVAL_SECONDS,
  SPAWNER_LOCAL_CAP
} from "@/lib/game/config";
import { FACTION_BY_KIND, MOB_TEMPLATES, mobHalfHeight } from "@/lib/game/mobs";
import { PROFESSIONS } from "@/lib/game/trades";
import { hostileCapScale, hostileSpawnIntervalScale, hostilesSpawn } from "@/lib/game/difficulties";
import { randomLandPointNear, randomWaterPointNear, type SurfaceYAtFn } from "@/lib/game/spawn";
import type { MobKind } from "@/lib/game/types";
import type { EmitGameEvent, GameState, MobState, PlayerState } from "../state";
import { nearestPlayerTo } from "../players";

export type SpawnGroupArgs = {
  kind: MobKind;
  hostile: boolean;
  count: number;
  centerX: number;
  centerZ: number;
  radius: number;
  /** Minimum distance from the center; keeps hostiles from spawning point-blank. */
  minRadius?: number;
};

/** Adds one mob standing with its feet at (x, y, z) (y is the ground, not the body center). */
export function pushMob(state: GameState, kind: MobKind, hostile: boolean, x: number, y: number, z: number, rng: () => number): void {
  const template = MOB_TEMPLATES[kind];
  const halfHeight = mobHalfHeight(kind);
  const mob: MobState = {
    id: state.nextMobId,
    kind,
    hostile,
    faction: FACTION_BY_KIND[kind],
    targetId: null,
    retargetTimer: 0,
    hp: template.hp,
    position: new THREE.Vector3(x, y + halfHeight, z),
    direction: new THREE.Vector3(rng() - 0.5, 0, rng() - 0.5).normalize(),
    yaw: 0,
    turnTimer: 1 + rng() * 3,
    speed: template.speed,
    moveSpeed: template.speed,
    detectRange: template.detectRange,
    attackDamage: template.attackDamage,
    attackCooldown: template.attackCooldown,
    attackTimer: rng(),
    halfHeight,
    bobSeed: rng() * 10,
    fedTimer: 0,
    ageTimer: 0
  };
  state.nextMobId += 1;
  state.mobs.push(mob);
}

/**
 * Spawns the single endgame boss with its feet at (x, y, z), bypassing the
 * hostile-cap directors (the totem summon is always allowed). Seeds its minion
 * timer so the first summon waits a full interval.
 */
export function spawnBoss(state: GameState, x: number, y: number, z: number, rng: () => number): void {
  pushMob(state, "boss", true, x, y, z, rng);
  state.mobs[state.mobs.length - 1].summonTimer = BOSS_SUMMON_INTERVAL_SECONDS;
}

export function spawnMobGroup(state: GameState, args: SpawnGroupArgs, rng: () => number, surfaceYAt: SurfaceYAtFn): void {
  for (let i = 0; i < args.count; i += 1) {
    const spawnPos = randomLandPointNear(state.world, surfaceYAt, args.centerX, args.centerZ, args.radius, rng, args.minRadius ?? 0);
    pushMob(state, args.kind, args.hostile, spawnPos.x, spawnPos.y, spawnPos.z, rng);
  }
}

/**
 * Spawns aquatic mobs submerged in open water near the center. Each needs a
 * water column at least 2 deep; a dry world (Superflat) or an inland center
 * simply yields fewer or zero — the sampler fails closed, never onto land.
 * pushMob expects ground-level feet, so the swim point converts to feet-y.
 * `minSpawnRadius` is the hostile standoff (per kind, chosen by the caller)
 * so nothing surfaces point-blank under a swimming player.
 */
export function spawnAquaticGroup(
  state: GameState,
  kind: MobKind,
  count: number,
  centerX: number,
  centerZ: number,
  radius: number,
  rng: () => number,
  hostile = false,
  minSpawnRadius = 0
): void {
  for (let i = 0; i < count; i += 1) {
    const pos = randomWaterPointNear(state.world, centerX, centerZ, radius, rng, 2, minSpawnRadius);
    if (!pos) return;
    pushMob(state, kind, hostile, pos.x, pos.y - mobHalfHeight(kind), pos.z, rng);
  }
}

/**
 * The day-one population around the player's spawn point. Passives scatter
 * over a wider ring than hostiles so the spawn area doesn't feel like a
 * petting zoo; hostiles stay closer (the dawn-aggro behavior tests document).
 */
export function spawnInitialMobs(state: GameState, rng: () => number, surfaceYAt: SurfaceYAtFn): void {
  // The nether's population is hostile-only — no animals, no fish, no
  // villagers — seeded around the arrival area at a respectful standoff.
  if (state.dimension === "nether") {
    if (!hostilesSpawn(state.difficulty)) return; // Peaceful nether: empty, still deadly terrain
    const anchor = nearestPlayerTo(state, state.world.sizeX / 2, state.world.sizeZ / 2);
    const cx = anchor ? anchor.position.x : state.world.sizeX / 2;
    const cz = anchor ? anchor.position.z : state.world.sizeZ / 2;
    const netherGroups: Array<[MobKind, number]> = [
      ["imp", 6],
      ["scorcher", 4]
    ];
    for (const [kind, count] of netherGroups) {
      spawnMobGroup(
        state,
        { kind, hostile: true, count, centerX: cx, centerZ: cz, radius: RENDER_RADIUS * 0.8, minRadius: HOSTILE_SPAWN_MIN_RADIUS },
        rng,
        surfaceYAt
      );
    }
    return;
  }
  // Day-one population centers on the booting player; a playerless world (a
  // fresh server room before the first join) seeds around the map center.
  const anchor = nearestPlayerTo(state, state.world.sizeX / 2, state.world.sizeZ / 2);
  const centerX = anchor ? anchor.position.x : state.world.sizeX / 2;
  const centerZ = anchor ? anchor.position.z : state.world.sizeZ / 2;
  const passiveRadius = RENDER_RADIUS * 1.2;
  const hostileRadius = RENDER_RADIUS * 0.7;
  const groups: Array<[MobKind, boolean, number, number]> = [
    ["sheep", false, 6, passiveRadius],
    ["chicken", false, 5, passiveRadius],
    ["horse", false, 3, passiveRadius],
    ["cow", false, 4, passiveRadius],
    ["pig", false, 4, passiveRadius],
    // Wild wolves and cats roam with the other animals (passive, flee the player)
    // until tamed with a bone / raw fish — without these they'd never appear and
    // companions would be unreachable.
    ["wolf", false, 4, passiveRadius],
    ["cat", false, 3, passiveRadius],
    // Villagers no longer scatter loosely — they live in generated villages now
    // (see spawnVillageResidents), so the world's villager population is its
    // settlements. A village-less world (e.g. all-ocean) simply has no villagers.
    ["zombie", true, 8, hostileRadius],
    ["skeleton", true, 6, hostileRadius],
    ["spider", true, 6, hostileRadius],
    ["creeper", true, 4, hostileRadius]
  ];
  // Peaceful spawns no hostiles at all — only the passive groups populate the world.
  const spawnHostiles = hostilesSpawn(state.difficulty);
  for (const [kind, hostile, count, radius] of groups) {
    if (hostile && !spawnHostiles) continue;
    // Hostiles keep a minimum standoff so nothing (notably a creeper) starts the
    // game point-blank; passives may roam right up to the spawn area.
    spawnMobGroup(state, { kind, hostile, count, centerX, centerZ, radius, minRadius: hostile ? HOSTILE_SPAWN_MIN_RADIUS : 0 }, rng, surfaceYAt);
  }
  // Fish school in whatever water lies near spawn; a landlocked spawn gets none
  // (the aquatic director repopulates oceans the player sails to later).
  spawnAquaticGroup(state, "cod", 6, centerX, centerZ, passiveRadius, rng);
  spawnAquaticGroup(state, "salmon", 4, centerX, centerZ, passiveRadius, rng);
}

/**
 * Trickles fish in around the player so any ocean feels stocked, not just the
 * spawn-time one. Every interval it tops the population up toward AQUATIC_CAP,
 * one small school at a time; without nearby deep water the sampler fails
 * closed and the tick is a no-op (Superflat never spawns a fish). At night the
 * same interval also trickles in the drowned — the water-bound hostile — gated
 * exactly like the land director (difficulty + darkness) under its own
 * DROWNED_CAP plus the shared difficulty-scaled hostile cap.
 */
export function tickAquaticSpawnDirector(state: GameState, dt: number, rng: () => number): void {
  if (state.dimension === "nether") return; // no water, no fish, no drowned
  state.timers.aquaticSpawnTimer += dt;
  if (state.timers.aquaticSpawnTimer < AQUATIC_SPAWN_INTERVAL_SECONDS) return;
  state.timers.aquaticSpawnTimer = 0;

  // Passive fish top-up. Hostiles never count against the fish budget — a full
  // night of drowned must not starve the cod schools.
  let fish = 0;
  for (const mob of state.mobs) if (MOB_TEMPLATES[mob.kind].aquatic && !mob.hostile) fish += 1;
  if (fish < AQUATIC_CAP) {
    const kind: MobKind = rng() < 0.6 ? "cod" : "salmon";
    const count = Math.min(AQUATIC_CAP - fish, 1 + (rng() > 0.6 ? 1 : 0));
    const center = spawnCenterPlayer(state, rng);
    if (!center) return;
    spawnAquaticGroup(state, kind, count, center.position.x, center.position.z, RENDER_RADIUS * 0.85, rng);
  }

  // Night waters turn hostile (Peaceful spawns none; daylight ends it).
  if (!hostilesSpawn(state.difficulty) || state.daylight >= HOSTILE_SPAWN_BELOW_DAYLIGHT) return;
  let drowned = 0;
  let hostiles = 0;
  for (const mob of state.mobs) {
    if (mob.kind === "drowned") drowned += 1;
    if (mob.hostile) hostiles += 1;
  }
  const cap = Math.round(HOSTILE_CAP * hostileCapScale(state.difficulty)) * partyCapScale(state);
  if (drowned >= DROWNED_CAP || hostiles >= cap) return;
  const center = spawnCenterPlayer(state, rng);
  if (!center) return;
  spawnAquaticGroup(state, "drowned", 1, center.position.x, center.position.z, RENDER_RADIUS * 0.85, rng, true, DROWNED_SPAWN_MIN_RADIUS);
}

/**
 * Seeds each village center with its resident villager population (faction
 * "villager", so they persist with the world). Called once when a world has no
 * villagers yet — a fresh world or one upgraded from a pre-village save; a reload
 * of a populated world restores its residents instead, so they aren't doubled.
 */
export function spawnVillageResidents(state: GameState, sites: Array<{ x: number; z: number }>, rng: () => number, surfaceYAt: SurfaceYAtFn): void {
  for (const site of sites) {
    for (let i = 0; i < GEN.villagersPerVillage; i += 1) {
      const pos = randomLandPointNear(state.world, surfaceYAt, site.x, site.z, 8, rng, 0);
      pushMob(state, "villager", false, pos.x, pos.y, pos.z, rng);
    }
  }
}

/**
 * Assigns a trade profession (round-robin) to every villager that doesn't have
 * one yet — newly seeded residents on a fresh world. Restored residents keep
 * their saved profession, so this skips them (they're not professionless).
 */
export function assignVillagerProfessions(state: GameState): void {
  let next = 0;
  for (const mob of state.mobs) {
    if (mob.faction !== "villager" || mob.profession != null) continue;
    mob.profession = PROFESSIONS[next % PROFESSIONS.length];
    next += 1;
  }
}

/**
 * The player a spawn wave centers on. One player: that player, with no rng
 * consumed — the single-player stream stays byte-identical to the old code.
 * Several players: a uniformly random one per wave, so spawns spread across
 * the party instead of piling onto whoever is primary. None: null (idle room).
 */
function spawnCenterPlayer(state: GameState, rng: () => number): PlayerState | null {
  if (state.players.size === 0) return null;
  if (state.players.size === 1) return state.players.values().next().value ?? null;
  const all = [...state.players.values()];
  return all[Math.min(all.length - 1, Math.floor(rng() * all.length))];
}

/**
 * Scales a global mob cap with the party size: 1–2 players keep the SP cap,
 * and each further pair adds another cap's worth — so 8 players don't starve
 * for mobs, but also don't each drag in a full private horde.
 */
function partyCapScale(state: GameState): number {
  return Math.max(1, Math.ceil(state.players.size / 2));
}

/**
 * Trickles hostile mobs in around the player at night, up to the cap.
 * Difficulty scales the cadence and cap; Peaceful spawns none. In the nether
 * the roster swaps to imps and scorchers — and the pinned daylight (under the
 * spawn threshold) makes the trickle perpetual: there is no dawn to end it.
 */
export function tickHostileSpawnDirector(state: GameState, dt: number, rng: () => number, surfaceYAt: SurfaceYAtFn): void {
  if (!hostilesSpawn(state.difficulty)) return;
  state.timers.hostileSpawnTimer += dt;
  const interval = HOSTILE_SPAWN_INTERVAL_SECONDS * hostileSpawnIntervalScale(state.difficulty);
  if (state.daylight >= HOSTILE_SPAWN_BELOW_DAYLIGHT || state.timers.hostileSpawnTimer < interval) return;
  state.timers.hostileSpawnTimer = 0;

  const cap = Math.round(HOSTILE_CAP * hostileCapScale(state.difficulty)) * partyCapScale(state);
  const livingHostiles = state.mobs.filter((mob) => mob.hostile).length;
  if (livingHostiles >= cap) return;

  const center = spawnCenterPlayer(state, rng);
  if (!center) return;
  const spawnKinds: MobKind[] = state.dimension === "nether" ? ["imp", "imp", "scorcher"] : ["zombie", "skeleton", "spider", "creeper"];
  const kind = spawnKinds[Math.floor(rng() * spawnKinds.length)];
  // A wave is 1–2 mobs, but never more than the slots left under the cap — so a
  // 2-pack rolled at cap-1 can't overshoot (especially Easy's tighter cap of 8).
  spawnMobGroup(
    state,
    {
      kind,
      hostile: true,
      count: Math.min(cap - livingHostiles, 1 + (rng() > 0.7 ? 1 : 0)),
      centerX: center.position.x,
      centerZ: center.position.z,
      radius: Math.max(26, RENDER_RADIUS * 0.85),
      minRadius: HOSTILE_SPAWN_MIN_RADIUS
    },
    rng,
    surfaceYAt
  );
}

const SPAWNER_KINDS: ReadonlyArray<"zombie" | "skeleton" | "spider"> = ["zombie", "skeleton", "spider"];

/**
 * Drips hostiles from dungeon spawners. On each interval, every intact spawner
 * with the player inside its activation radius spawns one hostile on the room
 * floor (feet at the spawner's own y, not the surface), bounded by a local
 * cluster cap and the shared global HOSTILE_CAP. Time-independent — dungeons
 * are dark. Spawner positions come from the session-derived index set, so
 * mining out a spawner block stops it (the world.get check below).
 */
export function tickSpawnerDirector(state: GameState, dt: number, rng: () => number, emit: EmitGameEvent): void {
  if (!hostilesSpawn(state.difficulty)) return; // Peaceful keeps even dungeon spawners inert
  if (state.dungeonSpawnerIndices.size === 0) return;
  state.timers.spawnerTimer += dt;
  if (state.timers.spawnerTimer < SPAWNER_INTERVAL_SECONDS) return;
  state.timers.spawnerTimer = 0;

  const cap = Math.round(HOSTILE_CAP * hostileCapScale(state.difficulty));
  const countHostiles = () => state.mobs.reduce((acc, mob) => acc + (mob.hostile ? 1 : 0), 0);
  if (countHostiles() >= cap) return;

  const { world } = state;
  const layer = world.sizeX * world.sizeZ;
  for (const idx of state.dungeonSpawnerIndices) {
    const sy = Math.floor(idx / layer);
    const rem = idx - sy * layer;
    const sz = Math.floor(rem / world.sizeX);
    const sx = rem - sz * world.sizeX;
    if (world.get(sx, sy, sz) !== BlockId.Spawner) continue; // mined out → inert
    // Any player inside the activation radius arms the spawner.
    let activated = false;
    for (const player of state.players.values()) {
      if (Math.hypot(player.position.x - (sx + 0.5), player.position.y - (sy + 0.5), player.position.z - (sz + 0.5)) <= SPAWNER_ACTIVATION_RADIUS) {
        activated = true;
        break;
      }
    }
    if (!activated) continue;
    if (countHostiles() >= cap) break;

    const nearby = state.mobs.reduce(
      (acc, mob) => acc + (mob.hostile && Math.hypot(mob.position.x - (sx + 0.5), mob.position.z - (sz + 0.5)) <= SPAWNER_ACTIVATION_RADIUS ? 1 : 0),
      0
    );
    if (nearby >= SPAWNER_LOCAL_CAP) continue;

    const kind = SPAWNER_KINDS[Math.floor(rng() * SPAWNER_KINDS.length)];
    const jx = sx + 0.5 + (rng() * 2 - 1) * 1.2;
    const jz = sz + 0.5 + (rng() * 2 - 1) * 1.2;
    pushMob(state, kind, true, jx, sy, jz, rng);
    emit({ type: "mobSpawned", kind, x: sx + 0.5, y: sy + 0.5, z: sz + 0.5 });
  }
}
