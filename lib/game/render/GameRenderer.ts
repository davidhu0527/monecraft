import * as THREE from "three";
import { BLOCK_COLORS, buildGeometryLayersRegion, createBlockAtlasTexture, voxelRaycast, VoxelWorld } from "@/lib/world";
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
import { createProjectileVisuals, type ProjectileVisuals } from "./projectileVisuals";
import { createBobberVisuals, type BobberVisuals } from "./bobberVisuals";
import { createPrecipitation, type PrecipitationView } from "./precipitation";
import { createSkyView, type SkyView } from "./skyView";
import { createSpearVisuals, type SpearVisuals } from "./spearVisuals";

const scratchEye = new THREE.Vector3();
const scratchDir = new THREE.Vector3();
const scratchPose = new THREE.Vector3();

export type CreateRendererResult = { ok: true; renderer: GameRenderer } | { ok: false; error: string };

// Caves keep this faint floor of visibility instead of going pure black, and
// block light is emitted with this warm tint.
const SKY_LIGHT_FLOOR = 0.05;
const TORCH_TINT = "vec3(1.35, 1.06, 0.62)";

/**
 * Add per-voxel darkness to a lit world material via the baked aLight attribute
 * (skyExposure, blockLight). The scene's sun + hemisphere already scale with
 * daylight, so day/night needs no extra uniform and no re-mesh: this patch gates
 * the scene-lit color by sky exposure — caves go dark while the surface stays
 * lit and dims at night with the scene lights — then adds block light back as an
 * albedo-tinted glow that survives the gate, so a torch lights a pitch-black
 * cave. Anchored on stable ShaderChunk includes; the e2e triangle check guards
 * against a future Three.js bump breaking the string replace.
 */
function patchVoxelLighting(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = "attribute vec2 aLight;\nvarying vec2 vLight;\n" + shader.vertexShader.replace("void main() {", "void main() {\n  vLight = aLight;");
    shader.fragmentShader =
      "varying vec2 vLight;\n" +
      shader.fragmentShader
        .replace("#include <color_fragment>", "#include <color_fragment>\n  vec3 mcAlbedo = diffuseColor.rgb;")
        .replace(
          "#include <opaque_fragment>",
          `#include <opaque_fragment>\n  gl_FragColor.rgb = gl_FragColor.rgb * max(vLight.x, ${SKY_LIGHT_FLOOR.toFixed(3)}) + mcAlbedo * vLight.y * ${TORCH_TINT};`
        );
  };
}

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
  private readonly glassMaterial: THREE.MeshStandardMaterial;
  private worldMesh: THREE.Mesh;
  private glassMesh: THREE.Mesh;
  private currentRegionX = Number.NaN;
  private currentRegionZ = Number.NaN;
  private readonly heldItem: HeldItemView;
  private readonly crackOverlay: CrackOverlayView;
  private readonly mobVisuals: MobVisuals;
  private readonly spearVisuals: SpearVisuals;
  private readonly projectileVisuals: ProjectileVisuals;
  private readonly bobberVisuals: BobberVisuals;
  private readonly bobberEye = new THREE.Vector3();
  private readonly playerVisuals: PlayerVisuals;
  private readonly particles: ParticleSystem;
  private readonly sky: SkyView;
  private readonly precip: PrecipitationView;
  private readonly overcastGray = new THREE.Color(0x6b7480);
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
    this.glassMaterial = new THREE.MeshStandardMaterial({
      map: this.worldMaterial.map,
      vertexColors: true,
      roughness: 0.18,
      metalness: 0.04,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.24,
      depthWrite: false
    });
    // Per-voxel lighting: gate scene-lit terrain by baked sky exposure and add
    // torch/lava block light back as a glow (see patchVoxelLighting).
    patchVoxelLighting(this.worldMaterial);
    patchVoxelLighting(this.glassMaterial);
    this.worldMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.worldMaterial);
    this.glassMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.glassMaterial);
    this.scene.add(this.worldMesh);
    this.scene.add(this.glassMesh);
    this.scene.add(this.camera);

    this.heldItem = createHeldItemView(this.camera);
    this.crackOverlay = createCrackOverlay(this.scene);
    this.mobVisuals = createMobVisuals(this.scene);
    this.spearVisuals = createSpearVisuals(this.scene);
    this.projectileVisuals = createProjectileVisuals(this.scene);
    this.bobberVisuals = createBobberVisuals(this.scene);
    this.playerVisuals = createPlayerVisuals(this.scene);
    this.particles = createParticleSystem(this.scene);
    this.sky = createSkyView(this.scene, this.camera);
    this.precip = createPrecipitation(this.scene);
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
    if (!state.paused) this.precip.sync(state, dtMs, this.camera.position);
    this.syncWorldMesh(state);
    this.heldItem.update(state.inventory[state.selectedSlot], {
      timeMs,
      miningActive: state.mining.targetKey !== "",
      moveFactor: state.player.onGround ? Math.min(1, Math.hypot(state.player.velocity.x, state.player.velocity.z) / WALK_SPEED) : 0,
      visible: state.cameraMode === "first"
    });
    this.crackOverlay.update(state.mining, state.world);
    this.mobVisuals.sync(state.mobs, timeMs);
    this.spearVisuals.sync(state.thrownSpears);
    this.projectileVisuals.sync(state.projectiles);
    this.bobberVisuals.sync(state.fishing, this.bobberEye.set(state.player.position.x, state.player.position.y + EYE_HEIGHT, state.player.position.z));
    this.playerVisuals.sync(state, timeMs);
    this.sky.sync(state, timeMs);
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
      case "mobSpawned":
        // A dark smoke puff conjured from the spawner.
        this.particles.emitBurst({
          x: event.x,
          y: event.y + 0.3,
          z: event.z,
          count: 16,
          color: [0.18, 0.16, 0.22],
          speed: 1.8,
          spread: 1.2,
          gravity: -2,
          drag: 1.8,
          life: [0.5, 1.0],
          size: 0.2,
          upBias: 0.5,
          colorJitter: 0.05
        });
        break;
      case "arrowHit":
        // Steel sparks on a block/mob; a redder spray when it bites the player.
        this.particles.emitBurst({
          x: event.x,
          y: event.y,
          z: event.z,
          count: event.target === "player" ? 8 : 6,
          color: event.target === "player" ? [0.82, 0.22, 0.22] : [0.72, 0.74, 0.78],
          speed: 2.2,
          spread: 1.0,
          gravity: 12,
          drag: 1.8,
          life: [0.18, 0.4],
          size: 0.1
        });
        break;
      case "bossSummoned":
        // A large, dark conjuring column where the boss appears.
        this.particles.emitBurst({
          x: event.x,
          y: event.y + 1.2,
          z: event.z,
          count: 40,
          color: [0.32, 0.12, 0.42],
          speed: 3.0,
          spread: 2.0,
          gravity: -1,
          drag: 1.4,
          life: [0.6, 1.3],
          size: 0.3,
          upBias: 0.6,
          colorJitter: 0.08
        });
        break;
      case "bossDefeated":
        // A bright triumphant burst on the kill.
        this.particles.emitBurst({
          x: event.x,
          y: event.y + 1.4,
          z: event.z,
          count: 48,
          color: [0.95, 0.82, 0.45],
          speed: 4.2,
          spread: 2.2,
          gravity: 6,
          drag: 1.2,
          life: [0.6, 1.4],
          size: 0.26,
          colorJitter: 0.12
        });
        break;
      case "explosion": {
        // A big fireball plus a slower smoke cloud, both scaled by the blast power.
        const p = event.power;
        this.particles.emitBurst({
          x: event.x,
          y: event.y,
          z: event.z,
          count: Math.round(28 * p),
          color: [0.96, 0.55, 0.16],
          speed: 3.5 + p,
          spread: p,
          gravity: 4,
          drag: 1.6,
          life: [0.3, 0.8],
          size: 0.32,
          colorJitter: 0.14
        });
        this.particles.emitBurst({
          x: event.x,
          y: event.y,
          z: event.z,
          count: Math.round(18 * p),
          color: [0.22, 0.2, 0.18],
          speed: 1.6,
          spread: p * 0.9,
          gravity: -1.5,
          drag: 1.3,
          life: [0.7, 1.6],
          size: 0.42,
          upBias: 0.5,
          colorJitter: 0.06
        });
        break;
      }
      case "tntPrimed":
        // A small spark puff at the fuse as it lights.
        this.particles.emitBurst({
          x: event.x + 0.5,
          y: event.y + 1,
          z: event.z + 0.5,
          count: 6,
          color: [1, 0.85, 0.4],
          speed: 1.4,
          spread: 0.6,
          gravity: 6,
          drag: 1.6,
          life: [0.2, 0.45],
          size: 0.1,
          upBias: 0.5
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
    this.precip.dispose();
    this.sky.dispose();
    this.particles.dispose();
    this.playerVisuals.dispose();
    this.spearVisuals.dispose();
    this.projectileVisuals.dispose();
    this.bobberVisuals.dispose();
    this.mobVisuals.dispose();
    this.crackOverlay.dispose();
    this.heldItem.dispose();
    this.scene.remove(this.worldMesh);
    this.scene.remove(this.glassMesh);
    this.worldMesh.geometry.dispose();
    this.glassMesh.geometry.dispose();
    this.worldMaterial.dispose();
    this.glassMaterial.dispose();
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
    const geometry = buildGeometryLayersRegion(world, regionX - RENDER_RADIUS, regionX + RENDER_RADIUS, regionZ - RENDER_RADIUS, regionZ + RENDER_RADIUS);
    this.scene.remove(this.worldMesh);
    this.scene.remove(this.glassMesh);
    this.worldMesh.geometry.dispose();
    this.glassMesh.geometry.dispose();
    this.worldMesh = new THREE.Mesh(geometry.opaque, this.worldMaterial);
    this.glassMesh = new THREE.Mesh(geometry.glass, this.glassMaterial);
    this.scene.add(this.worldMesh);
    this.scene.add(this.glassMesh);
  }

  private syncDayNight(state: GameState): void {
    const sunAngle = sunAngleAt(state.dayClock);
    const daylight = state.daylight;

    this.sun.position.set(Math.cos(sunAngle) * 110, Math.sin(sunAngle) * 108, Math.sin(sunAngle * 0.7) * 80);
    this.sun.intensity = 0.2 + daylight * 1.2;
    this.hemiLight.intensity = 0.24 + daylight * 1.05;

    this.liveSky.copy(this.nightSky).lerp(this.daySky, daylight);

    // Overcast: precipitation pulls the sky toward gray, dims the light, and
    // draws the fog in for an enclosed feel. Cosmetic — daylight itself is unchanged.
    const overcast = state.weather.kind === "clear" ? 0 : state.weather.intensity;
    if (overcast > 0) {
      this.liveSky.lerp(this.overcastGray, overcast * 0.6);
      this.sun.intensity *= 1 - overcast * 0.5;
      this.hemiLight.intensity *= 1 - overcast * 0.35;
    }
    this.scene.fog?.color.copy(this.liveSky);
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.far = 200 - overcast * 90;
  }
}
