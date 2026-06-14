import * as THREE from "three";
import { BlockId, doorState, isDoorBlock } from "@/lib/world";
import { EXPLOSION_DAMAGE_PER_POWER, TNT_CHAIN_FUSE_MAX_SECONDS, TNT_CHAIN_FUSE_MIN_SECONDS, TNT_EXPLOSION_POWER, TNT_FUSE_SECONDS } from "@/lib/game/config";
import type { EmitGameEvent, GameState } from "../state";

/**
 * Everything an explosion needs from the engine. A subset of `MobTickDeps`, so
 * the creeper branch in mobAI can pass its `deps` straight through.
 */
export type ExplosionDeps = {
  applyDamage: (amount: number) => void;
  rng: () => number;
  emit: EmitGameEvent;
};

/** Blocks the blast can never break (mirrors the mining unbreakables + worldgen hazards). */
function isBlastproof(block: BlockId): boolean {
  return block === BlockId.Bedrock || block === BlockId.Spawner || block === BlockId.Lava;
}

/** Higher = harder to destroy: the blast strength at a cell must exceed this to break it. */
function blastResistance(block: BlockId): number {
  switch (block) {
    case BlockId.Stone:
    case BlockId.Cobblestone:
    case BlockId.Brick:
    case BlockId.MossyCobblestone:
    case BlockId.Furnace:
    case BlockId.CoalOre:
    case BlockId.SliverOre:
    case BlockId.RubyOre:
    case BlockId.GoldOre:
    case BlockId.SapphireOre:
    case BlockId.DiamondOre:
      return 2.5;
    case BlockId.Chest:
      return 1.2;
    default:
      return 0.4; // dirt, sand, wood, planks, leaves, glass, doors, crops, torches, ...
  }
}

const scratchKnock = new THREE.Vector3();

/**
 * An explosion centered at (cx,cy,cz). It destroys blocks within `power` (a
 * distance falloff weighed against each block's blast resistance), then damages
 * the player and mobs out to twice that radius with the same falloff, and emits
 * one `explosion` event for the renderer/audio.
 *
 * It rides the existing single-block edit chokepoint: each destroyed cell goes
 * through `blockChanges.set` (which relights locally and records the save delta),
 * and `worldMeshDirty` is set **once** so the whole crater costs a single remesh.
 * It never removes mobs — it only lowers hp — so it is safe to call from inside
 * the mob tick loop; the caller sweeps any mob that reaches 0 hp.
 */
export function explode(state: GameState, cx: number, cy: number, cz: number, power: number, deps: ExplosionDeps): void {
  const { world } = state;
  const radius = Math.ceil(power);
  const bx = Math.floor(cx);
  const by = Math.floor(cy);
  const bz = Math.floor(cz);
  let changed = false;

  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > power) continue;
        const x = bx + dx;
        const y = by + dy;
        const z = bz + dz;
        if (!world.inBounds(x, y, z) || y <= 1) continue;
        const block = world.get(x, y, z) as BlockId;
        if (block === BlockId.Air || isBlastproof(block)) continue;
        if (power * (1 - dist / power) <= blastResistance(block)) continue;

        if (block === BlockId.Tnt) {
          // Chain reaction: light neighboring TNT on a short randomized fuse
          // instead of vaporizing it, so blasts ripple.
          const idx = world.index(x, y, z);
          if (!state.primedTnt.has(idx)) {
            state.primedTnt.set(idx, TNT_CHAIN_FUSE_MIN_SECONDS + deps.rng() * (TNT_CHAIN_FUSE_MAX_SECONDS - TNT_CHAIN_FUSE_MIN_SECONDS));
            deps.emit({ type: "tntPrimed", x, y, z });
          }
          continue;
        }
        if (isDoorBlock(block)) {
          const door = doorState(block)!;
          const otherY = door.upper ? y - 1 : y + 1;
          state.blockChanges.set(x, y, z, BlockId.Air);
          if (isDoorBlock(world.get(x, otherY, z) as BlockId)) state.blockChanges.set(x, otherY, z, BlockId.Air);
        } else {
          state.blockChanges.set(x, y, z, BlockId.Air);
        }
        changed = true;
      }
    }
  }
  if (changed) state.worldMeshDirty = true;

  const damageRange = power * 2;
  const peak = power * EXPLOSION_DAMAGE_PER_POWER;

  // Player: armor-aware damage + knockback away from the blast.
  const { player } = state;
  const pdist = Math.hypot(player.position.x - cx, player.position.y - cy, player.position.z - cz);
  if (pdist < damageRange) {
    const falloff = 1 - pdist / damageRange;
    deps.applyDamage(Math.max(1, Math.round(peak * falloff)));
    if (pdist > 0.001) {
      scratchKnock
        .set(player.position.x - cx, player.position.y - cy, player.position.z - cz)
        .normalize()
        .multiplyScalar(power * falloff);
      player.velocity.x += scratchKnock.x;
      player.velocity.z += scratchKnock.z;
      player.velocity.y = Math.max(player.velocity.y, Math.abs(scratchKnock.y) + 2);
    }
  }

  // Mobs: damage only — the caller removes any that reach 0 hp (so this is safe
  // to run mid mob-loop). A light directional shove reads as the blast pushing them.
  for (const mob of state.mobs) {
    const mdist = Math.hypot(mob.position.x - cx, mob.position.y - cy, mob.position.z - cz);
    if (mdist >= damageRange) continue;
    mob.hp -= Math.max(1, Math.round(peak * (1 - mdist / damageRange)));
    if (mdist > 0.001) mob.direction.set(mob.position.x - cx, 0, mob.position.z - cz).normalize();
  }

  deps.emit({ type: "explosion", x: cx, y: cy, z: cz, power });
}

/** Lights the TNT block at (x,y,z) on a full fuse (no-op if already lit). */
export function primeTnt(state: GameState, x: number, y: number, z: number, emit: EmitGameEvent): void {
  const idx = state.world.index(x, y, z);
  if (state.primedTnt.has(idx)) return;
  state.primedTnt.set(idx, TNT_FUSE_SECONDS);
  emit({ type: "tntPrimed", x, y, z });
}

/**
 * Counts down lit TNT and detonates it. A TNT block mined or replaced before its
 * fuse runs out is silently dropped (the block check). Detonations run after the
 * countdown pass so a blast's chain-priming can't mutate the map mid-iteration.
 */
export function tickPrimedTnt(state: GameState, dt: number, deps: ExplosionDeps): void {
  if (state.primedTnt.size === 0) return;
  const { world } = state;
  const layer = world.sizeX * world.sizeZ;
  const detonations: Array<[number, number, number]> = [];

  for (const [idx, timer] of state.primedTnt) {
    const y = Math.floor(idx / layer);
    const rem = idx - y * layer;
    const z = Math.floor(rem / world.sizeX);
    const x = rem - z * world.sizeX;
    if (world.get(x, y, z) !== BlockId.Tnt) {
      state.primedTnt.delete(idx); // mined or overwritten → forget it
      continue;
    }
    const next = timer - dt;
    if (next > 0) {
      state.primedTnt.set(idx, next);
    } else {
      state.primedTnt.delete(idx);
      detonations.push([x, y, z]);
    }
  }

  for (const [x, y, z] of detonations) {
    state.blockChanges.set(x, y, z, BlockId.Air);
    state.worldMeshDirty = true;
    explode(state, x + 0.5, y + 0.5, z + 0.5, TNT_EXPLOSION_POWER, deps);
  }
}
