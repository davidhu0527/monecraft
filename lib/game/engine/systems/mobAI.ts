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
  SKELETON_ARROW_DAMAGE,
  SKELETON_ARROW_SPEED,
  SKELETON_FIRE_VGAP,
  SKELETON_LEAD_FACTOR,
  SKELETON_STANDOFF_MAX,
  SKELETON_STANDOFF_MIN,
  SPIDER_AGGRO_BELOW_DAYLIGHT
} from "@/lib/game/config";
import { MOB_TEMPLATES } from "@/lib/game/mobs";
import { mobsThreaten } from "@/lib/game/gameModes";
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
function fireBossSpread(state: GameState, mob: MobState, emit: EmitGameEvent): void {
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
      damage: BOSS_ARROW_DAMAGE,
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
  removeMobAt: (index: number) => void;
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

  for (let i = 0; i < mobs.length; i += 1) {
    const mob = mobs[i];
    // A mob killed earlier this tick (e.g. by an explosion) still awaits the
    // post-loop sweep — skip its AI so a corpse can't move or land a final hit.
    if (mob.hp <= 0) continue;
    mob.attackTimer -= dt;
    mob.turnTimer -= dt;
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

    if (activeHostile && distanceToPlayer < mob.detectRange) {
      if (distanceToPlayer > 0.001) mob.direction.lerp(scratchToPlayer.normalize(), 0.2).normalize();
      moveSpeed *= 1.15;
      // Skeletons kite (back off / hold in a standoff band); the boss bears down.
      if (isRanged && !isBoss) {
        if (distanceToPlayer < SKELETON_STANDOFF_MIN) moveSign = -1;
        else if (distanceToPlayer <= SKELETON_STANDOFF_MAX) moveSign = 0;
      }
    } else if (!mob.hostile && mob.kind !== "villager" && distanceToPlayer < 4.2) {
      // Animals flee when you get close; villagers don't, so you can walk up to trade.
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
        deps.applyDamage(isBoss ? BOSS_MELEE_DAMAGE : mob.attackDamage);
        if (distanceToPlayer > 0.001) {
          scratchToPlayer.normalize().multiplyScalar(isBoss ? 6 : 4.2);
          playerVelocity.x += scratchToPlayer.x;
          playerVelocity.z += scratchToPlayer.z;
          playerVelocity.y = Math.max(playerVelocity.y, isBoss ? 4.5 : 3.4);
        }
      } else if (fireReady) {
        if (isBoss) fireBossSpread(state, mob, deps.emit);
        else fireMobArrow(state, mob, SKELETON_ARROW_DAMAGE, SKELETON_ARROW_SPEED, deps.emit);
      }
      mob.attackTimer = mob.attackCooldown;
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
  // an explosion earlier in the same pass, including the creeper that just blew up.
  for (let i = mobs.length - 1; i >= 0; i -= 1) {
    if (mobs[i].hp <= 0) deps.removeMobAt(i);
  }
}
