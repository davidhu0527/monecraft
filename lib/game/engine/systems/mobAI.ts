import * as THREE from "three";
import { collidesAt, voxelRaycast } from "@/lib/world";
import {
  ARROW_TTL,
  BOSS_ARROW_DAMAGE,
  BOSS_ARROW_SPEED,
  BOSS_MELEE_DAMAGE,
  BOSS_MELEE_REACH,
  BOSS_MINION_CAP,
  BOSS_SPREAD,
  BOSS_SUMMON_INTERVAL_SECONDS,
  CREEPER_ABORT_RANGE,
  CREEPER_EXPLOSION_POWER,
  CREEPER_FUSE_RANGE,
  CREEPER_FUSE_SECONDS,
  HOSTILE_BURN_ABOVE_DAYLIGHT,
  HOSTILE_CAP,
  MOB_ARROW_KNOCKBACK,
  MOB_RETARGET_SECONDS,
  MOB_VS_MOB_KNOCKBACK,
  MOB_VS_MOB_REACH,
  SKELETON_ARROW_DAMAGE,
  SKELETON_ARROW_SPEED,
  SKELETON_FIRE_VGAP,
  SKELETON_LEAD_FACTOR,
  SKELETON_STANDOFF_MAX,
  SKELETON_STANDOFF_MIN,
  SPIDER_AGGRO_BELOW_DAYLIGHT,
  VILLAGER_FLEE_RANGE
} from "@/lib/game/config";
import { MOB_TEMPLATES } from "@/lib/game/mobs";
import type { MobFaction } from "@/lib/game/types";
import { mobsThreaten } from "@/lib/game/gameModes";
import { mobDamageMultiplier } from "@/lib/game/difficulties";
import type { EmitGameEvent, GameState, MobState } from "../state";
import { spawnArrow } from "../projectiles";
import { explode } from "./explosion";
import { pushMob } from "./spawnDirector";
import type { SurfaceYAtFn } from "@/lib/game/spawn";

// Scratch vectors — per-frame tick over every mob must not allocate.
const UP = new THREE.Vector3(0, 1, 0);
const scratchToPlayer = new THREE.Vector3();
const scratchToPlayer3D = new THREE.Vector3();
const scratchMobEye = new THREE.Vector3();
const scratchPlayerAim = new THREE.Vector3();
const scratchRay = new THREE.Vector3();
const scratchMobFeet = new THREE.Vector3();
const scratchAim = new THREE.Vector3();
const scratchToTarget = new THREE.Vector3();

const NO_ENEMIES: ReadonlySet<MobFaction> = new Set<MobFaction>();

/**
 * The shared enmity table — which factions each faction will attack. "Fighters"
 * (hostile/raider/ally) hunt enemy-faction mobs; wild animals and villagers never
 * fight. Hostiles & raiders go after villagers and pets; pets defend against
 * hostiles & raiders.
 */
const ENEMY_FACTIONS: Record<MobFaction, ReadonlySet<MobFaction>> = {
  wild: NO_ENEMIES,
  villager: NO_ENEMIES,
  hostile: new Set<MobFaction>(["villager", "ally"]),
  raider: new Set<MobFaction>(["villager", "ally"]),
  ally: new Set<MobFaction>(["hostile", "raider"])
};

/** Factions a villager flees from. */
const THREAT_FACTIONS: ReadonlySet<MobFaction> = new Set<MobFaction>(["hostile", "raider"]);

/**
 * Victim factions whose death credits the player with loot + XP. A pet's kill
 * still feeds you ("your wolf hunts for you"); a slain villager or pet yields
 * nothing — which also closes the XP leak of farming mobs that kill each other.
 */
const CREDITED_FACTIONS: ReadonlySet<MobFaction> = new Set<MobFaction>(["wild", "hostile", "raider"]);

function horizDistSq(a: MobState, b: MobState): number {
  const dx = a.position.x - b.position.x;
  const dz = a.position.z - b.position.z;
  return dx * dx + dz * dz;
}

function mobById(state: GameState, id: number): MobState | null {
  for (const other of state.mobs) if (other.id === id) return other;
  return null;
}

/**
 * The mob (if any) this fighter is hunting. It keeps its cached `targetId` while
 * that mob is alive, still an enemy, and in range; otherwise it re-scans for the
 * nearest enemy-faction mob — but only every MOB_RETARGET_SECONDS, so the per-mob
 * tick stays O(N) and full scans amortize to ~1–2 Hz per fighter. Non-fighters
 * (wild/villager) have no enemies and return null immediately.
 */
function selectMobTarget(state: GameState, mob: MobState): MobState | null {
  const enemies = ENEMY_FACTIONS[mob.faction];
  if (enemies.size === 0) return null;
  const rangeSq = mob.detectRange * mob.detectRange;
  if (mob.targetId !== null && mob.retargetTimer > 0) {
    const cached = mobById(state, mob.targetId);
    if (cached && cached.hp > 0 && enemies.has(cached.faction) && horizDistSq(mob, cached) < rangeSq) return cached;
  }
  mob.retargetTimer = MOB_RETARGET_SECONDS;
  let best: MobState | null = null;
  let bestSq = rangeSq;
  for (const other of state.mobs) {
    if (other === mob || other.hp <= 0 || !enemies.has(other.faction)) continue;
    const d = horizDistSq(mob, other);
    if (d < bestSq) {
      bestSq = d;
      best = other;
    }
  }
  mob.targetId = best ? best.id : null;
  return best;
}

/** Nearest hostile/raider within `range` of a villager (drives its flee), or null. */
function nearestThreat(state: GameState, mob: MobState, range: number): MobState | null {
  let best: MobState | null = null;
  let bestSq = range * range;
  for (const other of state.mobs) {
    if (other.hp <= 0 || !THREAT_FACTIONS.has(other.faction)) continue;
    const d = horizDistSq(mob, other);
    if (d < bestSq) {
      bestSq = d;
      best = other;
    }
  }
  return best;
}

/**
 * A ranged mob looses an arrow from its eye toward the player's chest, leading a
 * moving target by a fraction of the arrow's travel time. The arrow is not
 * player-owned, so it only ever hits the player (never the firer or other mobs).
 */
function fireMobArrow(state: GameState, mob: MobState, damage: number, speed: number, emit: EmitGameEvent): void {
  const { player } = state;
  const eyeY = mob.position.y + mob.halfHeight * 0.7;
  const dist = Math.hypot(player.position.x - mob.position.x, player.position.z - mob.position.z);
  const lead = (dist / speed) * SKELETON_LEAD_FACTOR;
  scratchAim.set(
    player.position.x + player.velocity.x * lead - mob.position.x,
    player.position.y + 0.9 - eyeY,
    player.position.z + player.velocity.z * lead - mob.position.z
  );
  spawnArrow(state, mob.position.x, eyeY, mob.position.z, scratchAim, {
    speed,
    damage,
    knockback: MOB_ARROW_KNOCKBACK,
    fromPlayer: false,
    ttl: ARROW_TTL
  });
  emit({ type: "mobAttacked", kind: mob.kind });
}

/** The boss looses a 3-arrow horizontal spread aimed at the player's chest. */
function fireBossSpread(state: GameState, mob: MobState, dmgScale: number, emit: EmitGameEvent): void {
  const { player } = state;
  const eyeY = mob.position.y + mob.halfHeight * 0.7;
  const baseX = player.position.x - mob.position.x;
  const baseY = player.position.y + 0.9 - eyeY;
  const baseZ = player.position.z - mob.position.z;
  for (let spread = -1; spread <= 1; spread += 1) {
    scratchAim.set(baseX, baseY, baseZ);
    if (spread !== 0) scratchAim.applyAxisAngle(UP, spread * BOSS_SPREAD);
    spawnArrow(state, mob.position.x, eyeY, mob.position.z, scratchAim, {
      speed: BOSS_ARROW_SPEED,
      damage: BOSS_ARROW_DAMAGE * dmgScale,
      knockback: MOB_ARROW_KNOCKBACK,
      fromPlayer: false,
      ttl: ARROW_TTL
    });
  }
  emit({ type: "mobAttacked", kind: mob.kind });
}

/**
 * The boss periodically conjures a skeleton or zombie nearby while it is engaged,
 * up to its own minion cap and the shared global hostile cap.
 */
function tickBossSummon(state: GameState, mob: MobState, dt: number, deps: MobTickDeps): void {
  mob.summonTimer = (mob.summonTimer ?? 0) - dt;
  if (mob.summonTimer > 0) return;
  mob.summonTimer = BOSS_SUMMON_INTERVAL_SECONDS;

  let minions = 0;
  let hostiles = 0;
  for (const other of state.mobs) {
    if (!other.hostile) continue;
    hostiles += 1;
    if (other.kind !== "boss") minions += 1;
  }
  if (minions >= BOSS_MINION_CAP || hostiles >= HOSTILE_CAP) return;

  const kind = deps.rng() < 0.5 ? "skeleton" : "zombie";
  const angle = deps.rng() * Math.PI * 2;
  const radius = 2 + deps.rng() * 2;
  const mx = mob.position.x + Math.cos(angle) * radius;
  const mz = mob.position.z + Math.sin(angle) * radius;
  const my = deps.surfaceYAt(mx, mz);
  pushMob(state, kind, true, mx, my, mz, deps.rng);
  deps.emit({ type: "mobSpawned", kind, x: mx, y: my, z: mz });
}

export type MobTickDeps = {
  surfaceYAt: SurfaceYAtFn;
  applyDamage: (amount: number) => void;
  /** Removes the mob (post-loop sweep). `credit` (default true) gates loot + XP to the player. */
  removeMobAt: (index: number, lootingLevel?: number, credit?: boolean) => void;
  rng: () => number;
  emit: EmitGameEvent;
};

export function tickMobs(state: GameState, dt: number, deps: MobTickDeps): void {
  const { world, daylight, mobs, isDead } = state;
  const playerPosition = state.player.position;
  const playerVelocity = state.player.velocity;
  // Creative/Spectator players aren't a threat target — hostiles ignore them
  // entirely (no aggro, attacks, fuses, or summons), so they just wander.
  const threatened = mobsThreaten(state.gameMode);
  // Difficulty scales every hit a mob lands (melee + arrows): Easy 0.5×, Hard 1.5×.
  // Applied here at the strike, never by mutating the per-mob templates.
  const dmgScale = mobDamageMultiplier(state.difficulty);

  for (let i = 0; i < mobs.length; i += 1) {
    const mob = mobs[i];
    // A mob killed earlier this tick (e.g. by an explosion) still awaits the
    // post-loop sweep — skip its AI so a corpse can't move or land a final hit.
    if (mob.hp <= 0) continue;
    mob.attackTimer -= dt;
    mob.turnTimer -= dt;
    mob.retargetTimer -= dt;
    const activeHostile = threatened && mob.hostile && (mob.kind !== "spider" || daylight < SPIDER_AGGRO_BELOW_DAYLIGHT);

    scratchToPlayer.copy(playerPosition).sub(mob.position).setY(0);
    const distanceToPlayer = scratchToPlayer.length();
    scratchToPlayer3D.copy(playerPosition).sub(mob.position);
    const attackDistance = scratchToPlayer3D.length();
    const verticalGap = Math.abs(scratchToPlayer3D.y);
    let moveSpeed = mob.speed;
    const isBoss = mob.kind === "boss";
    const isRanged = MOB_TEMPLATES[mob.kind].ranged === true;
    let moveSign = 1;

    // A fighter that isn't chasing the player hunts the nearest enemy-faction mob
    // (a hostile after a villager, a pet after a hostile). Creepers stay
    // player-focused — they detonate rather than bite.
    const playerAggro = activeHostile && distanceToPlayer < mob.detectRange;
    const mobTarget = !playerAggro && mob.kind !== "creeper" ? selectMobTarget(state, mob) : null;

    if (playerAggro) {
      if (distanceToPlayer > 0.001) mob.direction.lerp(scratchToPlayer.normalize(), 0.2).normalize();
      moveSpeed *= 1.15;
      // Skeletons kite (back off / hold in a standoff band); the boss bears down.
      if (isRanged && !isBoss) {
        if (distanceToPlayer < SKELETON_STANDOFF_MIN) moveSign = -1;
        else if (distanceToPlayer <= SKELETON_STANDOFF_MAX) moveSign = 0;
      }
    } else if (mobTarget) {
      scratchToTarget.copy(mobTarget.position).sub(mob.position).setY(0);
      if (scratchToTarget.lengthSq() > 1e-6) mob.direction.lerp(scratchToTarget.normalize(), 0.2).normalize();
      moveSpeed *= 1.15;
    } else if (mob.faction === "villager") {
      // Villagers don't fight — they flee the nearest hostile/raider, else mill about.
      const threat = nearestThreat(state, mob, VILLAGER_FLEE_RANGE);
      if (threat) {
        scratchToTarget.copy(mob.position).sub(threat.position).setY(0);
        if (scratchToTarget.lengthSq() > 1e-6) mob.direction.lerp(scratchToTarget.normalize(), 0.2).normalize();
        moveSpeed *= 1.3;
      } else if (mob.turnTimer <= 0) {
        mob.direction.applyAxisAngle(UP, (deps.rng() - 0.5) * Math.PI).normalize();
        mob.turnTimer = 1.5 + deps.rng() * 4;
      }
    } else if (!mob.hostile && distanceToPlayer < 4.2) {
      // Wild animals flee when you get close (villagers are handled above).
      if (distanceToPlayer > 0.001) mob.direction.lerp(scratchToPlayer.normalize().multiplyScalar(-1), 0.2).normalize();
      moveSpeed *= 1.15;
    } else if (mob.turnTimer <= 0) {
      mob.direction.applyAxisAngle(UP, (deps.rng() - 0.5) * Math.PI).normalize();
      mob.turnTimer = 1.5 + deps.rng() * 4;
    }
    mob.moveSpeed = moveSpeed;

    let nx = mob.position.x + mob.direction.x * moveSpeed * dt * moveSign;
    let nz = mob.position.z + mob.direction.z * moveSpeed * dt * moveSign;

    if (nx < 2 || nz < 2 || nx > world.sizeX - 2 || nz > world.sizeZ - 2) {
      mob.direction.multiplyScalar(-1);
      nx = mob.position.x + mob.direction.x * moveSpeed * dt * moveSign;
      nz = mob.position.z + mob.direction.z * moveSpeed * dt * moveSign;
      mob.turnTimer = 1;
    }

    let ground = deps.surfaceYAt(nx, nz);
    scratchMobFeet.set(nx, ground, nz);
    if (collidesAt(world, scratchMobFeet, 0.28, mob.halfHeight * 2)) {
      mob.direction.multiplyScalar(-1);
      nx = mob.position.x;
      nz = mob.position.z;
      ground = mob.position.y - mob.halfHeight;
      mob.turnTimer = 1;
    }
    mob.position.set(nx, ground + mob.halfHeight, nz);
    mob.yaw = Math.atan2(mob.direction.x, mob.direction.z);

    // Ranged mobs shoot from across their detect range; melee mobs (and the boss
    // up close) must be adjacent. The boss reaches a little farther for melee.
    const meleeReach = isBoss ? BOSS_MELEE_REACH : 4;
    const meleeVGap = isBoss ? SKELETON_FIRE_VGAP : 1.6;
    const meleeReady = activeHostile && attackDistance < meleeReach && verticalGap < meleeVGap;
    const fireReady = isRanged && activeHostile && attackDistance < mob.detectRange && verticalGap < SKELETON_FIRE_VGAP;
    // A creeper close enough to light its fuse also needs a line-of-sight check —
    // it can be in range with a large vertical gap (so not meleeReady), which
    // would otherwise arm the fuse off the default `hasLineOfSight = true`.
    const creeperFuseReady = mob.kind === "creeper" && activeHostile && attackDistance < CREEPER_FUSE_RANGE;

    let hasLineOfSight = true;
    if (meleeReady || fireReady || creeperFuseReady) {
      scratchMobEye.set(mob.position.x, mob.position.y + mob.halfHeight * 0.35, mob.position.z);
      scratchPlayerAim.set(playerPosition.x, playerPosition.y + 0.9, playerPosition.z);
      scratchRay.copy(scratchPlayerAim).sub(scratchMobEye);
      if (scratchRay.lengthSq() > 1e-6) {
        const hit = voxelRaycast(world, scratchMobEye, scratchRay.normalize(), attackDistance + 0.5);
        hasLineOfSight = hit === null;
      }
    }

    // !isDead: mobs keep ticking through the respawn countdown, but attacking a
    // corpse should neither sound nor re-arm the attack cooldown.
    if (!isDead && (meleeReady || fireReady) && hasLineOfSight && mob.attackTimer <= 0) {
      // The boss bites when adjacent, otherwise looses a spread; skeletons only
      // ever shoot; melee mobs only ever bite. Creepers never bite — they detonate.
      const doMelee = meleeReady && (!isRanged || isBoss) && mob.kind !== "creeper";
      if (doMelee) {
        deps.emit({ type: "mobAttacked", kind: mob.kind });
        deps.applyDamage((isBoss ? BOSS_MELEE_DAMAGE : mob.attackDamage) * dmgScale);
        if (distanceToPlayer > 0.001) {
          scratchToPlayer.normalize().multiplyScalar(isBoss ? 6 : 4.2);
          playerVelocity.x += scratchToPlayer.x;
          playerVelocity.z += scratchToPlayer.z;
          playerVelocity.y = Math.max(playerVelocity.y, isBoss ? 4.5 : 3.4);
        }
      } else if (fireReady) {
        if (isBoss) fireBossSpread(state, mob, dmgScale, deps.emit);
        else fireMobArrow(state, mob, SKELETON_ARROW_DAMAGE * dmgScale, SKELETON_ARROW_SPEED, deps.emit);
      }
      mob.attackTimer = mob.attackCooldown;
    }

    // Mob-vs-mob melee: a fighter with a live mob target bites it when adjacent.
    // Independent of the player (it happens through the respawn countdown too) and
    // of difficulty (dmgScale scales player-facing damage only). No LOS raycast —
    // mob collision already keeps fighters from closing through walls. The kill is
    // resolved by the post-loop sweep, never mid-loop (splice-safety).
    if (mobTarget && mob.attackDamage > 0 && mob.attackTimer <= 0 && mobTarget.hp > 0) {
      const dx = mobTarget.position.x - mob.position.x;
      const dz = mobTarget.position.z - mob.position.z;
      const horiz = Math.hypot(dx, dz);
      if (horiz < MOB_VS_MOB_REACH && Math.abs(mobTarget.position.y - mob.position.y) < 1.6) {
        mobTarget.hp -= mob.attackDamage;
        if (horiz > 0.001) {
          const push = MOB_VS_MOB_KNOCKBACK / horiz;
          mobTarget.position.x += dx * push;
          mobTarget.position.z += dz * push;
        }
        deps.emit({ type: "mobAttacked", kind: mob.kind });
        mob.attackTimer = mob.attackCooldown;
      }
    }

    // The boss conjures minions while it is engaged with the player.
    if (!isDead && isBoss && activeHostile && distanceToPlayer < mob.detectRange) {
      tickBossSummon(state, mob, dt, deps);
    }

    // A creeper lights its fuse when it gets close, then detonates — destroying
    // terrain and hurting the player and nearby mobs. Walk out of range while it
    // is primed and the fuse aborts. It dies in its own blast (dropping gunpowder
    // via the post-loop sweep); killing it before the fuse runs out cancels it.
    if (!isDead && mob.kind === "creeper") {
      if ((mob.fuseTimer ?? 0) > 0) {
        if (!activeHostile || distanceToPlayer > CREEPER_ABORT_RANGE) {
          mob.fuseTimer = 0;
        } else {
          mob.fuseTimer = (mob.fuseTimer ?? 0) - dt;
          if (mob.fuseTimer <= 0) {
            explode(state, mob.position.x, mob.position.y, mob.position.z, CREEPER_EXPLOSION_POWER, deps);
            mob.hp = 0;
          }
        }
      } else if (creeperFuseReady && hasLineOfSight) {
        mob.fuseTimer = CREEPER_FUSE_SECONDS;
        deps.emit({ type: "mobAttacked", kind: "creeper" }); // the hiss
      }
    }

    // Zombies, skeletons, and creepers burn in broad daylight; the boss is immune.
    if (mob.hostile && mob.kind !== "spider" && mob.kind !== "boss" && daylight > HOSTILE_BURN_ABOVE_DAYLIGHT) {
      mob.hp -= dt * 0.8;
    }
  }

  // Sweep the dead after the loop (descending, so splices don't shift live
  // indices). A post-loop sweep — not per-iteration — also catches mobs killed by
  // an explosion (or another mob) earlier in the same pass, including the creeper
  // that just blew up. Loot + XP go to the player only for credited factions, so a
  // pet's kill feeds you but a slain villager/pet yields nothing.
  for (let i = mobs.length - 1; i >= 0; i -= 1) {
    const dead = mobs[i];
    if (dead.hp <= 0) deps.removeMobAt(i, 0, CREDITED_FACTIONS.has(dead.faction));
  }
}
