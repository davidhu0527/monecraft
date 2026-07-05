import * as THREE from "three";
import { WALK_SPEED } from "@/lib/game/config";
import type { PlayerId, PlayerState } from "@/lib/game/engine/state";
import { DEFAULT_PLAYER_PALETTE, SKIN_PRESETS, type SkinId } from "@/lib/game/playerSkins";
import { applyPalette, createPlayerModel, type PlayerModel } from "./playerModel";
import { computePlayerPose } from "./playerPose";

/**
 * Other players' bodies in a multiplayer world: one humanoid per remote
 * PlayerState (the same procedural model/pose math as the local third-person
 * body) plus a floating name tag — a canvas-drawn sprite, in line with the
 * zero-asset rule (mirrors the renderer's hostile health bars). Poses arrive
 * already interpolated (NetworkSession writes them into state.players), so
 * this layer only mirrors state → scene, estimating gait from frame-to-frame
 * movement.
 */

export type RemotePlayerInfo = { name: string; skinId: string | null };

export type RemotePlayerVisuals = {
  /** Reconciles models with state.players (minus the primary). Call once per frame. */
  sync(players: Map<PlayerId, PlayerState>, primaryId: PlayerId, info: (id: PlayerId) => RemotePlayerInfo, timeMs: number): void;
  dispose(): void;
};

function makeNameTag(name: string): { sprite: THREE.Sprite; texture: THREE.Texture; material: THREE.SpriteMaterial } {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 48;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = "28px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(name.slice(0, 16), canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.6, 0.3, 1);
  sprite.position.y = 1.35; // above the head (model origin is the body center)
  return { sprite, texture, material };
}

type RemoteEntry = {
  model: PlayerModel;
  tag: ReturnType<typeof makeNameTag>;
  lastPosition: THREE.Vector3;
  lastTimeMs: number;
  skinKey: string;
};

export function createRemotePlayerVisuals(scene: THREE.Scene): RemotePlayerVisuals {
  const entries = new Map<PlayerId, RemoteEntry>();

  const remove = (id: PlayerId) => {
    const entry = entries.get(id);
    if (!entry) return;
    scene.remove(entry.model.group);
    for (const material of entry.model.materials) material.dispose();
    for (const geometry of entry.model.geometries) geometry.dispose();
    entry.tag.texture.dispose();
    entry.tag.material.dispose();
    entries.delete(id);
  };

  return {
    sync(players, primaryId, info, timeMs) {
      for (const [id, player] of players) {
        if (id === primaryId) continue;
        let entry = entries.get(id);
        if (!entry) {
          const model = createPlayerModel();
          const meta = info(id);
          const tag = makeNameTag(meta.name);
          model.group.add(tag.sprite);
          scene.add(model.group);
          entry = { model, tag, lastPosition: player.position.clone(), lastTimeMs: timeMs, skinKey: "" };
          entries.set(id, entry);
        }
        const meta = info(id);
        if (entry.skinKey !== (meta.skinId ?? "default")) {
          entry.skinKey = meta.skinId ?? "default";
          const preset = SKIN_PRESETS.find((p) => p.id === (entry!.skinKey as SkinId));
          applyPalette(entry.model, preset?.palette ?? DEFAULT_PLAYER_PALETTE);
        }

        entry.model.group.position.copy(player.position);
        entry.model.group.rotation.y = player.yaw;
        entry.model.head.rotation.x = player.pitch;

        // Gait from observed movement (poses are interpolated, velocity is unknown).
        const dtMs = Math.max(1, timeMs - entry.lastTimeMs);
        const speed = (entry.lastPosition.distanceTo(player.position) / dtMs) * 1000;
        entry.lastPosition.copy(player.position);
        entry.lastTimeMs = timeMs;
        const pose = computePlayerPose({
          timeMs,
          moveFactor: Math.min(1, speed / WALK_SPEED),
          miningActive: player.mining.targetKey !== "",
          swingStartMs: -Infinity,
          castStartMs: -Infinity,
          reelStartMs: -Infinity,
          fishingActive: false
        });
        entry.model.leftArm.rotation.x = pose.leftArmX;
        entry.model.rightArm.rotation.x = pose.rightArmX;
        entry.model.leftLeg.rotation.x = pose.leftLegX;
        entry.model.rightLeg.rotation.x = pose.rightLegX;
        entry.model.group.visible = !player.isDead;
      }

      // Gone players drop their models.
      for (const id of [...entries.keys()]) {
        if (!players.has(id) || id === primaryId) remove(id);
      }
    },

    dispose() {
      for (const id of [...entries.keys()]) remove(id);
    }
  };
}
