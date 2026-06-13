import * as THREE from "three";
import { HOSTILE_CAP, HOSTILE_SPAWN_BELOW_DAYLIGHT, HOSTILE_SPAWN_INTERVAL_SECONDS, RENDER_RADIUS } from "@/lib/game/config";
import { MOB_TEMPLATES, mobHalfHeight } from "@/lib/game/mobs";
import { randomLandPointNear, type SurfaceYAtFn } from "@/lib/game/spawn";
import type { MobKind } from "@/lib/game/types";
import type { GameState, MobState } from "../state";

export type SpawnGroupArgs = {
  kind: MobKind;
  hostile: boolean;
  count: number;
  centerX: number;
  centerZ: number;
  radius: number;
};

export function spawnMobGroup(state: GameState, args: SpawnGroupArgs, rng: () => number, surfaceYAt: SurfaceYAtFn): void {
  const template = MOB_TEMPLATES[args.kind];
  const halfHeight = mobHalfHeight(args.kind);
  for (let i = 0; i < args.count; i += 1) {
    const spawnPos = randomLandPointNear(state.world, surfaceYAt, args.centerX, args.centerZ, args.radius, rng);
    const mob: MobState = {
      id: state.nextMobId,
      kind: args.kind,
      hostile: args.hostile,
      hp: template.hp,
      position: new THREE.Vector3(spawnPos.x, spawnPos.y + halfHeight, spawnPos.z),
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
    ["zombie", true, 8, hostileRadius],
    ["skeleton", true, 6, hostileRadius],
    ["spider", true, 6, hostileRadius]
  ];
  for (const [kind, hostile, count, radius] of groups) {
    spawnMobGroup(state, { kind, hostile, count, centerX, centerZ, radius }, rng, surfaceYAt);
  }
}

/** Trickles hostile mobs in around the player at night, up to the cap. */
export function tickHostileSpawnDirector(state: GameState, dt: number, rng: () => number, surfaceYAt: SurfaceYAtFn): void {
  state.timers.hostileSpawnTimer += dt;
  if (state.daylight >= HOSTILE_SPAWN_BELOW_DAYLIGHT || state.timers.hostileSpawnTimer < HOSTILE_SPAWN_INTERVAL_SECONDS) return;
  state.timers.hostileSpawnTimer = 0;

  const livingHostiles = state.mobs.filter((mob) => mob.hostile).length;
  if (livingHostiles >= HOSTILE_CAP) return;

  const spawnKinds: Array<"zombie" | "skeleton" | "spider"> = ["zombie", "skeleton", "spider"];
  const kind = spawnKinds[Math.floor(rng() * spawnKinds.length)];
  spawnMobGroup(
    state,
    {
      kind,
      hostile: true,
      count: 1 + (rng() > 0.7 ? 1 : 0),
      centerX: state.player.position.x,
      centerZ: state.player.position.z,
      radius: Math.max(26, RENDER_RADIUS * 0.85)
    },
    rng,
    surfaceYAt
  );
}
