import * as THREE from "three";
import { buildGeometryRegion, createBlockAtlasTexture, VoxelWorld } from "@/lib/world";
import { EYE_HEIGHT, RENDER_GRID, RENDER_RADIUS, WALK_SPEED } from "@/lib/game/config";
import { sunAngleAt } from "@/lib/game/engine/systems/dayNight";
import type { GameState } from "@/lib/game/engine/state";
import { createCrackOverlay, type CrackOverlayView } from "./crackOverlay";
import { createHeldItemView, type HeldItemView } from "./heldItem";
import { createMobVisuals, type MobVisuals } from "./mobVisuals";

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
    this.syncCamera(state);
    this.syncWorldMesh(state);
    this.heldItem.update(state.inventory[state.selectedSlot], {
      timeMs,
      miningActive: state.mining.targetKey !== "",
      moveFactor: state.player.onGround ? Math.min(1, Math.hypot(state.player.velocity.x, state.player.velocity.z) / WALK_SPEED) : 0
    });
    this.crackOverlay.update(state.mining, state.world);
    this.mobVisuals.sync(state.mobs, timeMs);
    this.syncDayNight(state);
  }

  render(): void {
    this.webgl.render(this.scene, this.camera);
  }

  /** One-shot held-item swing for attack clicks (hit or miss). */
  triggerSwing(): void {
    this.heldItem.triggerSwing();
  }

  handleResize(): void {
    this.camera.aspect = this.mount.clientWidth / this.mount.clientHeight;
    this.camera.updateProjectionMatrix();
    this.webgl.setSize(this.mount.clientWidth, this.mount.clientHeight);
  }

  dispose(): void {
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
    this.camera.position.set(position.x, position.y + EYE_HEIGHT, position.z);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = yaw;
    this.camera.rotation.x = pitch;
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
