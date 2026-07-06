import * as THREE from "three";
import { BlockId, voxelRaycast, type VoxelWorld } from "@/lib/world";
import { EYE_HEIGHT, MINE_REACH, PORTAL_MAX_INTERIOR, PORTAL_MIN_INTERIOR } from "@/lib/game/config";
import { consumeToolDurability } from "@/lib/game/inventory";
import type { EmitGameEvent, GameState, PlayerState } from "../state";
import { lookDirection } from "./playerMotion";

const scratchEye = new THREE.Vector3();
const scratchDir = new THREE.Vector3();

/**
 * A validated portal frame: `axis` is the horizontal direction the interior
 * runs along, `base` its lowest interior cell nearest the axis origin, and
 * `w`×`h` the interior size. The obsidian border encloses it fully, corners
 * included (stricter than Minecraft's corner-optional rule — one simple shape).
 */
export type PortalFrame = { axis: "x" | "z"; base: { x: number; y: number; z: number }; w: number; h: number };

/** A cell the portal surface may occupy: air before ignition, the surface itself after. */
function isInteriorCell(block: number): boolean {
  return block === BlockId.Air || block === BlockId.NetherPortal;
}

/**
 * Validates the portal frame around an interior candidate cell: slides down and
 * sideways to the interior's base corner, measures the rectangle, then requires
 * every interior cell open and a full obsidian border (corners included) on
 * both axes' candidate planes. Bounded by PORTAL_MIN/MAX_INTERIOR. Pure — used
 * at ignition AND re-run at travel time as the broken-frame backstop.
 */
export function findPortalFrame(world: VoxelWorld, x: number, y: number, z: number): PortalFrame | null {
  if (!isInteriorCell(world.get(x, y, z))) return null;
  for (const axis of ["x", "z"] as const) {
    const frame = findFrameOnAxis(world, x, y, z, axis);
    if (frame) return frame;
  }
  return null;
}

function findFrameOnAxis(world: VoxelWorld, x: number, y: number, z: number, axis: "x" | "z"): PortalFrame | null {
  const dx = axis === "x" ? 1 : 0;
  const dz = axis === "z" ? 1 : 0;

  // Slide down to the interior's bottom row (bounded by the max height).
  let baseY = y;
  while (baseY > 1 && y - baseY < PORTAL_MAX_INTERIOR.h - 1 && isInteriorCell(world.get(x, baseY - 1, z))) baseY -= 1;
  if (world.get(x, baseY - 1, z) !== BlockId.Obsidian) return null;

  // Slide to the interior's min corner along the axis (bounded by the max width).
  let bx = x;
  let bz = z;
  for (let guard = 0; guard < PORTAL_MAX_INTERIOR.w - 1 && isInteriorCell(world.get(bx - dx, baseY, bz - dz)); guard += 1) {
    bx -= dx;
    bz -= dz;
  }

  // Measure the interior rectangle from the base corner.
  let w = 0;
  while (w < PORTAL_MAX_INTERIOR.w && isInteriorCell(world.get(bx + dx * w, baseY, bz + dz * w))) w += 1;
  let h = 0;
  while (h < PORTAL_MAX_INTERIOR.h && isInteriorCell(world.get(bx, baseY + h, bz))) h += 1;
  if (w < PORTAL_MIN_INTERIOR.w || h < PORTAL_MIN_INTERIOR.h) return null;

  // Every interior cell must be open…
  for (let i = 0; i < w; i += 1) {
    for (let j = 0; j < h; j += 1) {
      if (!isInteriorCell(world.get(bx + dx * i, baseY + j, bz + dz * i))) return null;
    }
  }
  // …inside a full obsidian border. Corners ride the top/bottom rows (i = -1
  // and i = w); an oversize interior also fails here (the cell past the max
  // width/height would have to be obsidian, but it read as interior above).
  for (let i = -1; i <= w; i += 1) {
    if (world.get(bx + dx * i, baseY - 1, bz + dz * i) !== BlockId.Obsidian) return null;
    if (world.get(bx + dx * i, baseY + h, bz + dz * i) !== BlockId.Obsidian) return null;
  }
  for (let j = 0; j < h; j += 1) {
    if (world.get(bx - dx, baseY + j, bz - dz) !== BlockId.Obsidian) return null;
    if (world.get(bx + dx * w, baseY + j, bz + dz * w) !== BlockId.Obsidian) return null;
  }
  return { axis, base: { x: bx, y: baseY, z: bz }, w, h };
}

/** Fills a validated frame's interior with the portal surface (each cell rides the block diff + relight). */
export function fillPortalFrame(state: GameState, frame: PortalFrame): void {
  const dx = frame.axis === "x" ? 1 : 0;
  const dz = frame.axis === "z" ? 1 : 0;
  for (let i = 0; i < frame.w; i += 1) {
    for (let j = 0; j < frame.h; j += 1) {
      state.blockChanges.set(frame.base.x + dx * i, frame.base.y + j, frame.base.z + dz * i, BlockId.NetherPortal);
    }
  }
  state.worldMeshDirty = true;
}

/**
 * Right-click use of flint & steel on an obsidian block: the cell in front of
 * the struck face is the interior candidate. A valid frame lights (fills with
 * the portal surface, wears the striker by one) — unless portals are disabled
 * (an online world), which denies with its own reason so the shell can explain.
 * Returns true when the click is consumed, even on a refusal.
 */
export function tryIgnitePortal(state: GameState, player: PlayerState, emit: EmitGameEvent, allowed: boolean, rng: () => number): boolean {
  const slot = player.inventory[player.selectedSlot];
  if (slot?.id !== "flint_and_steel" || slot.count <= 0) return false;
  scratchEye.set(player.position.x, player.position.y + EYE_HEIGHT, player.position.z);
  lookDirection(player.yaw, player.pitch, scratchDir);
  const result = voxelRaycast(state.world, scratchEye, scratchDir, MINE_REACH);
  if (!result) return false;
  if (state.world.get(result.hit.x, result.hit.y, result.hit.z) !== BlockId.Obsidian) return false;

  const frame = findPortalFrame(state.world, result.previous.x, result.previous.y, result.previous.z);
  if (!frame) {
    emit({ type: "portalDenied", reason: "invalidFrame" });
    return true;
  }
  if (!allowed) {
    emit({ type: "portalDenied", reason: "online" });
    return true;
  }
  fillPortalFrame(state, frame);
  player.inventory = consumeToolDurability(player.inventory, player.selectedSlot, 1, rng) ?? player.inventory;
  emit({ type: "portalLit" });
  return true;
}

/**
 * Called when an obsidian block breaks: flood-clears any portal surface that
 * was attached to it, so a de-framed portal never lingers. Bounded (a surface
 * is at most MAX w×h, but the cap guards pathological hand-placed fields).
 * Travel-time revalidation (tickPortalDwell, next slice) is the backstop for
 * frames broken out of this hook's reach.
 */
export function clearAttachedPortal(state: GameState, x: number, y: number, z: number): void {
  const stack: Array<[number, number, number]> = [];
  for (const [ox, oy, oz] of [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1]
  ] as const) {
    if (state.world.get(x + ox, y + oy, z + oz) === BlockId.NetherPortal) stack.push([x + ox, y + oy, z + oz]);
  }
  if (stack.length === 0) return;
  const visited = new Set<number>();
  let cleared = 0;
  while (stack.length > 0 && cleared < 64) {
    const [cx, cy, cz] = stack.pop()!;
    const key = state.world.index(cx, cy, cz);
    if (visited.has(key)) continue;
    visited.add(key);
    if (state.world.get(cx, cy, cz) !== BlockId.NetherPortal) continue;
    state.blockChanges.set(cx, cy, cz, BlockId.Air);
    cleared += 1;
    stack.push([cx + 1, cy, cz], [cx - 1, cy, cz], [cx, cy + 1, cz], [cx, cy - 1, cz], [cx, cy, cz + 1], [cx, cy, cz - 1]);
  }
  state.worldMeshDirty = true;
}
