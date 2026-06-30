import * as THREE from "three";
import { BlockId } from "@/lib/world";
import { GEN } from "@/lib/world/generation";
import {
  BOSS_SUMMON_INTERVAL_SECONDS,
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
import { randomLandPointNear, type SurfaceYAtFn } from "@/lib/game/spawn";
import type { MobKind } from "@/lib/game/types";
import type { EmitGameEvent, GameState, MobState } from "../state";

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
 * The day-one population around the player's spawn point. Passives scatter
 * over a wider ring than hostiles so the spawn area doesn't feel like a
 * petting zoo; hostiles stay closer (the dawn-aggro behavior tests document).
 */
export function spawnInitialMobs(state: GameState, rng: () => number, surfaceYAt: SurfaceYAtFn): void {
  const centerX = state.player.position.x;
  const centerZ = state.player.position.z;
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

/** Trickles hostile mobs in around the player at night, up to the cap. Difficulty scales the cadence and cap; Peaceful spawns none. */
export function tickHostileSpawnDirector(state: GameState, dt: number, rng: () => number, surfaceYAt: SurfaceYAtFn): void {
  if (!hostilesSpawn(state.difficulty)) return;
  state.timers.hostileSpawnTimer += dt;
  const interval = HOSTILE_SPAWN_INTERVAL_SECONDS * hostileSpawnIntervalScale(state.difficulty);
  if (state.daylight >= HOSTILE_SPAWN_BELOW_DAYLIGHT || state.timers.hostileSpawnTimer < interval) return;
  state.timers.hostileSpawnTimer = 0;

  const cap = Math.round(HOSTILE_CAP * hostileCapScale(state.difficulty));
  const livingHostiles = state.mobs.filter((mob) => mob.hostile).length;
  if (livingHostiles >= cap) return;

  const spawnKinds: Array<"zombie" | "skeleton" | "spider" | "creeper"> = ["zombie", "skeleton", "spider", "creeper"];
  const kind = spawnKinds[Math.floor(rng() * spawnKinds.length)];
  // A wave is 1–2 mobs, but never more than the slots left under the cap — so a
  // 2-pack rolled at cap-1 can't overshoot (especially Easy's tighter cap of 8).
  spawnMobGroup(
    state,
    {
      kind,
      hostile: true,
      count: Math.min(cap - livingHostiles, 1 + (rng() > 0.7 ? 1 : 0)),
      centerX: state.player.position.x,
      centerZ: state.player.position.z,
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

  const { player, world } = state;
  const layer = world.sizeX * world.sizeZ;
  for (const idx of state.dungeonSpawnerIndices) {
    const sy = Math.floor(idx / layer);
    const rem = idx - sy * layer;
    const sz = Math.floor(rem / world.sizeX);
    const sx = rem - sz * world.sizeX;
    if (world.get(sx, sy, sz) !== BlockId.Spawner) continue; // mined out → inert
    if (Math.hypot(player.position.x - (sx + 0.5), player.position.y - (sy + 0.5), player.position.z - (sz + 0.5)) > SPAWNER_ACTIVATION_RADIUS) continue;
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
