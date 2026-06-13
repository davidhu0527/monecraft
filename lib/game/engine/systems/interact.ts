import * as THREE from "three";
import { BlockId, voxelRaycast } from "@/lib/world";
import { EYE_HEIGHT, MINE_REACH, SLEEP_ALLOWED_BELOW_DAYLIGHT, SLEEP_FADE_SECONDS, SLEEP_HOSTILE_RADIUS } from "@/lib/game/config";
import type { EmitGameEvent, GameState } from "../state";
import { lookDirection } from "./playerMotion";

const scratchEye = new THREE.Vector3();
const scratchDir = new THREE.Vector3();

/** Blocks whose right-click runs a handler instead of placing the held block. */
export type InteractiveKind = "bed";

export const INTERACTIVE_BLOCKS: Partial<Record<BlockId, InteractiveKind>> = {
  [BlockId.Bed]: "bed"
};

/**
 * Right-click "use" on the aimed block. Returns true when the click was an
 * interaction (consumed — the caller must NOT then place a block), false when
 * the aimed block has no behavior and placement should proceed.
 *
 * This is the shared hook future interactive blocks (furnace, …) plug into:
 * add a `BlockId → kind` entry and a branch below.
 */
export function tryInteractBlock(state: GameState, emit: EmitGameEvent): boolean {
  const { world, player } = state;
  scratchEye.set(player.position.x, player.position.y + EYE_HEIGHT, player.position.z);
  lookDirection(player.yaw, player.pitch, scratchDir);
  const result = voxelRaycast(world, scratchEye, scratchDir, MINE_REACH);
  if (!result) return false;

  const block = world.get(result.hit.x, result.hit.y, result.hit.z) as BlockId;
  const kind = INTERACTIVE_BLOCKS[block];
  if (!kind) return false;

  if (kind === "bed") return interactBed(state, emit, result.hit.x, result.hit.y, result.hit.z);
  return false;
}

/** Sleep in a bed: only at night, only when no hostile is near. Sets the respawn point. */
function interactBed(state: GameState, emit: EmitGameEvent, x: number, y: number, z: number): boolean {
  if (state.daylight >= SLEEP_ALLOWED_BELOW_DAYLIGHT) {
    emit({ type: "sleepDenied", reason: "daylight" });
    return true;
  }
  for (const mob of state.mobs) {
    if (mob.hostile && mob.position.distanceTo(state.player.position) <= SLEEP_HOSTILE_RADIUS) {
      emit({ type: "sleepDenied", reason: "hostiles" });
      return true;
    }
  }

  state.spawnPoint = { x, y, z };
  state.sleepTimer = SLEEP_FADE_SECONDS;
  emit({ type: "sleepStarted" });
  return true;
}
