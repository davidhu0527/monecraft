import * as THREE from "three";
import { BLOCK_COLORS, buildGeometryRegion, createBlockAtlasTexture, voxelRaycast, VoxelWorld } from "@/lib/world";
import { EYE_HEIGHT, RENDER_GRID, RENDER_RADIUS, THIRD_PERSON_DISTANCE, THIRD_PERSON_MARGIN, WALK_SPEED } from "@/lib/game/config";
import { sunAngleAt } from "@/lib/game/engine/systems/dayNight";
import type { GameEvent, GameState } from "@/lib/game/engine/state";
import { MOB_TEMPLATES } from "@/lib/game/mobs";
import type { PlayerPalette } from "@/lib/game/playerSkins";
import { cameraOffsetDirection, computeCameraPose } from "./cameraView";
import { createCrackOverlay, type CrackOverlayView } from "./crackOverlay";
import { createHeldItemView, type HeldItemView } from "./heldItem";
import { createMobVisuals, type MobVisuals } from "./mobVisuals";
import { createParticleSystem, hexToRgb, type ParticleSystem } from "./particleSystem";
import { createPlayerVisuals, type PlayerVisuals } from "./playerVisuals";

const scratchEye = new THREE.Vector3();
const scratchDir = new THREE.Vector3();
const scratchPose = new THREE.Vector3();

export type CreateRendererResult = { ok: true; renderer: GameRenderer } | { ok: false; error: string };

/**
 * Maps simulation state to Three.js every frame in sync(): camera from
 * yaw/pitch, world mesh from the voxel data (region-windowed, rebuilt when the
 * player crosses a RENDER_GRID boundary or state.worldMeshDirty is set), mob
 * models keyed by mob id, the held item, the crack overlay, and day-night
 * lighting. Owns every GPU resource and frees them in dispose().
 */
export class GameRenderer {
  private readonly mount: HTMLElement;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly webgl: THREE.WebGLRenderer;
  private readonly sun: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly daySky = new THREE.Color(0x8bc2ff);
  private readonly nightSky = new THREE.Color(0x06111f);
  private readonly liveSky = new THREE.Color(0x8bc2ff);
  private readonly worldMaterial: THREE.MeshStandardMaterial;
  private worldMesh: THREE.Mesh;
  private currentRegionX = Number.NaN;
  private currentRegionZ = Number.NaN;
  private readonly heldItem: HeldItemView;
  private readonly crackOverlay: CrackOverlayView;
  private readonly mobVisuals: MobVisuals;
  private readonly playerVisuals: PlayerVisuals;
  private readonly particles: ParticleSystem;
  private lastSyncMs = Number.NaN;
  private dustDistance = 0;
  private lastFootX = Number.NaN;
  private lastFootZ = Number.NaN;

  /** WebGL context creation can fail (blocked, unsupported) — surface it instead of throwing. */
  static create(mount: HTMLElement): CreateRendererResult {
    try {
      return { ok: true, renderer: new GameRenderer(mount) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Failed to initialize WebGL renderer" };
    }
  }

  private constructor(mount: HTMLElement) {
    this.mount = mount;
    this.scene = new THREE.Scene();
    this.scene.background = this.liveSky;
    this.scene.fog = new THREE.Fog(this.liveSky, 30, 200);

    this.camera = new THREE.PerspectiveCamera(75, mount.clientWidth / mount.clientHeight, 0.1, 2000);
    this.webgl = new THREE.WebGLRenderer({ antialias: true });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.webgl.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(this.webgl.domElement);

    this.hemiLight = new THREE.HemisphereLight(0xd7efff, 0x9a907f, 1.18);
    this.scene.add(this.hemiLight);

    this.sun = new THREE.DirectionalLight(0xfff4da, 1.28);
    this.sun.position.set(40, 95, 24);
    this.scene.add(this.sun);

    this.worldMaterial = new THREE.MeshStandardMaterial({
      map: createBlockAtlasTexture(),
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.02,
      side: THREE.DoubleSide
    });
    this.worldMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.worldMaterial);
    this.scene.add(this.worldMesh);
    this.scene.add(this.camera);

    this.heldItem = createHeldItemView(this.camera);
    this.crackOverlay = createCrackOverlay(this.scene);
    this.mobVisuals = createMobVisuals(this.scene);
    this.playerVisuals = createPlayerVisuals(this.scene);
    this.particles = createParticleSystem(this.scene);
  }

  get domElement(): HTMLCanvasElement {
    return this.webgl.domElement;
  }

  /** Triangles drawn in the last render() — lets E2E tests prove the scene renders without reading pixels. */
  renderedTriangles(): number {
    return this.webgl.info.render.triangles;
  }

  /** Pulls everything visible from the simulation state. Call once per frame, then render(). */
  sync(state: GameState, timeMs: number): void {
    const dtMs = Number.isNaN(this.lastSyncMs) ? 16 : Math.max(0, timeMs - this.lastSyncMs);
    this.lastSyncMs = timeMs;
    if (!state.paused) {
      this.particles.update(dtMs);
      this.emitFootstepDust(state);
    }
    this.syncCamera(state);
    this.syncWorldMesh(state);
    this.heldItem.update(state.inventory[state.selectedSlot], {
      timeMs,
      miningActive: state.mining.targetKey !== "",
      moveFactor: state.player.onGround ? Math.min(1, Math.hypot(state.player.velocity.x, state.player.velocity.z) / WALK_SPEED) : 0,
      visible: state.cameraMode === "first"
    });
    this.crackOverlay.update(state.mining, state.world);
    this.mobVisuals.sync(state.mobs, timeMs);
    this.playerVisuals.sync(state, timeMs);
    this.syncDayNight(state);
  }

  render(): void {
    this.webgl.render(this.scene, this.camera);
  }

  /** One-shot swing for attack clicks (hit or miss) — held item and body arm. */
  triggerSwing(): void {
    this.heldItem.triggerSwing();
    this.playerVisuals.triggerSwing();
  }

  /** Spawns particle bursts for one-shot gameplay events (parallel to audio). */
  handleEvent(event: GameEvent, state: GameState): void {
    switch (event.type) {
      case "blockBroken":
        this.particles.emitBurst({
          x: event.x + 0.5,
          y: event.y + 0.5,
          z: event.z + 0.5,
          count: 10,
          color: BLOCK_COLORS[event.blockId] ?? [0.6, 0.6, 0.6],
          speed: 3.2,
          spread: 1.0,
          gravity: 14,
          drag: 1.6,
          life: [0.35, 0.7],
          size: 0.16,
          colorJitter: 0.08
        });
        break;
      case "blockPlaced":
        this.particles.emitBurst({
          x: event.x + 0.5,
          y: event.y + 0.5,
          z: event.z + 0.5,
          count: 6,
          color: BLOCK_COLORS[event.blockId] ?? [0.6, 0.6, 0.6],
          speed: 1.2,
          spread: 0.6,
          gravity: 6,
          drag: 2.2,
          life: [0.25, 0.45],
          size: 0.12,
          upBias: 0.6
        });
        break;
      case "mobDied":
        this.particles.emitBurst({
          x: event.x,
          y: event.y + 0.4,
          z: event.z,
          count: 14,
          color: hexToRgb(MOB_TEMPLATES[event.kind].modelArgs[0] as number),
          speed: 2.6,
          spread: 1.4,
          gravity: 10,
          drag: 1.4,
          life: [0.4, 0.8],
          size: 0.18
        });
        break;
      case "ateFood":
        this.particles.emitBurst({
          x: state.player.position.x,
          y: state.player.position.y + 1.4,
          z: state.player.position.z,
          count: 5,
          color: [0.82, 0.6, 0.4],
          speed: 1.6,
          spread: 0.8,
          gravity: 12,
          drag: 1.5,
          life: [0.25, 0.5],
          size: 0.1
        });
        break;
      case "landed":
        this.particles.emitBurst({
          x: state.player.position.x,
          y: state.player.position.y,
          z: state.player.position.z,
          count: Math.min(12, 3 + Math.floor(event.impact)),
          color: [0.7, 0.62, 0.5],
          speed: 0.8 + event.impact * 0.12,
          spread: 1.2,
          gravity: 8,
          drag: 2.5,
          life: [0.2, 0.45],
          size: 0.13,
          upBias: 0.4
        });
        break;
      case "jumped":
        this.particles.emitBurst({
          x: state.player.position.x,
          y: state.player.position.y,
          z: state.player.position.z,
          count: 4,
          color: [0.7, 0.62, 0.5],
          speed: 1.0,
          spread: 1.0,
          gravity: 8,
          drag: 2.5,
          life: [0.15, 0.35],
          size: 0.11
        });
        break;
    }
  }

  /** Kicks a small dust puff every couple of strides while walking on the ground. */
  private emitFootstepDust(state: GameState): void {
    const { player } = state;
    if (state.isDead || !player.onGround || Number.isNaN(this.lastFootX)) {
      this.lastFootX = player.position.x;
      this.lastFootZ = player.position.z;
      return;
    }
    this.dustDistance += Math.hypot(player.position.x - this.lastFootX, player.position.z - this.lastFootZ);
    this.lastFootX = player.position.x;
    this.lastFootZ = player.position.z;
    if (this.dustDistance < 2.4) return;
    this.dustDistance = 0;
    this.particles.emitBurst({
      x: player.position.x,
      y: player.position.y + 0.05,
      z: player.position.z,
      count: 2,
      color: [0.66, 0.58, 0.46],
      speed: 0.5,
      spread: 0.5,
      gravity: 6,
      drag: 2.6,
      life: [0.2, 0.4],
      size: 0.1,
      upBias: 0.3
    });
  }

  /** Applies a skin preset's palette to the player body (live recolor). */
  setPlayerSkin(palette: PlayerPalette): void {
    this.playerVisuals.setPalette(palette);
  }

  handleResize(): void {
    this.camera.aspect = this.mount.clientWidth / this.mount.clientHeight;
    this.camera.updateProjectionMatrix();
    this.webgl.setSize(this.mount.clientWidth, this.mount.clientHeight);
  }

  dispose(): void {
    this.particles.dispose();
    this.playerVisuals.dispose();
    this.mobVisuals.dispose();
    this.crackOverlay.dispose();
    this.heldItem.dispose();
    this.scene.remove(this.worldMesh);
    this.worldMesh.geometry.dispose();
    this.worldMaterial.dispose();
    this.webgl.dispose();
    this.mount.removeChild(this.webgl.domElement);
  }

  private syncCamera(state: GameState): void {
    const { position, yaw, pitch } = state.player;
    scratchEye.set(position.x, position.y + EYE_HEIGHT, position.z);

    let distance = 0;
    if (state.cameraMode !== "first") {
      // Clamp the boom against terrain so walls never occlude the player.
      const dir = cameraOffsetDirection(state.cameraMode, yaw, pitch, scratchDir);
      const hit = voxelRaycast(state.world, scratchEye, dir, THIRD_PERSON_DISTANCE);
      distance = hit ? Math.max(0, hit.distance - THIRD_PERSON_MARGIN) : THIRD_PERSON_DISTANCE;
    }

    const pose = computeCameraPose(state.cameraMode, scratchEye.x, scratchEye.y, scratchEye.z, yaw, pitch, distance, scratchPose);
    this.camera.position.set(pose.posX, pose.posY, pose.posZ);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = pose.yaw;
    this.camera.rotation.x = pose.pitch;
  }

  private syncWorldMesh(state: GameState): void {
    const regionX = Math.floor(state.player.position.x / RENDER_GRID) * RENDER_GRID;
    const regionZ = Math.floor(state.player.position.z / RENDER_GRID) * RENDER_GRID;
    if (!state.worldMeshDirty && regionX === this.currentRegionX && regionZ === this.currentRegionZ) return;

    state.worldMeshDirty = false;
    this.currentRegionX = regionX;
    this.currentRegionZ = regionZ;

    this.rebuildWorldMesh(state.world, regionX, regionZ);
  }

  private rebuildWorldMesh(world: VoxelWorld, regionX: number, regionZ: number): void {
    const geometry = buildGeometryRegion(world, regionX - RENDER_RADIUS, regionX + RENDER_RADIUS, regionZ - RENDER_RADIUS, regionZ + RENDER_RADIUS);
    this.scene.remove(this.worldMesh);
    this.worldMesh.geometry.dispose();
    this.worldMesh = new THREE.Mesh(geometry, this.worldMaterial);
    this.scene.add(this.worldMesh);
  }

  private syncDayNight(state: GameState): void {
    const sunAngle = sunAngleAt(state.dayClock);
    const daylight = state.daylight;

    this.sun.position.set(Math.cos(sunAngle) * 110, Math.sin(sunAngle) * 108, Math.sin(sunAngle * 0.7) * 80);
    this.sun.intensity = 0.2 + daylight * 1.2;
    this.hemiLight.intensity = 0.24 + daylight * 1.05;

    this.liveSky.copy(this.nightSky).lerp(this.daySky, daylight);
    this.scene.fog?.color.copy(this.liveSky);
  }
}
