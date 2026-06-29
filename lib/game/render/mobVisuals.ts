import * as THREE from "three";
import { BABY_SCALE } from "@/lib/game/config";
import { createMobModelForKind, MOB_TEMPLATES } from "@/lib/game/mobs";
import type { MobModel } from "@/lib/game/types";
import type { MobState } from "@/lib/game/engine/state";

type HealthBar = {
  group: THREE.Group;
  fill: THREE.Sprite;
  materials: THREE.SpriteMaterial[];
  width: number;
};

type MobVisual = {
  model: MobModel;
  healthBar: HealthBar | null;
};

export type MobVisuals = {
  /** Creates/removes models to match the mob list and animates bob + gait. */
  sync(mobs: MobState[], timeMs: number): void;
  dispose(): void;
};

function createHealthBar(kind: MobState["kind"]): HealthBar {
  const [bodySize, headSize] = [MOB_TEMPLATES[kind].modelArgs[5], MOB_TEMPLATES[kind].modelArgs[6]];
  const width = Math.max(0.9, bodySize[0], headSize[0]);
  const headTop = bodySize[1] * 0.88 + headSize[1] * 0.5;
  const backgroundMaterial = new THREE.SpriteMaterial({ color: 0x1a0808, depthWrite: false });
  const fillMaterial = new THREE.SpriteMaterial({ color: 0x35d04f, depthWrite: false });
  const background = new THREE.Sprite(backgroundMaterial);
  const fill = new THREE.Sprite(fillMaterial);
  const group = new THREE.Group();

  group.name = "hostile-health-bar";
  group.position.y = headTop + 0.35;
  background.name = "hostile-health-background";
  background.scale.set(width + 0.08, 0.18, 1);
  fill.name = "hostile-health-fill";
  fill.position.z = 0.001;
  fill.scale.set(width, 0.11, 1);
  group.add(background, fill);

  return { group, fill, materials: [backgroundMaterial, fillMaterial], width };
}

export function createMobVisuals(scene: THREE.Scene): MobVisuals {
  const visuals = new Map<number, MobVisual>();
  const seen = new Set<number>();

  const removeModel = (id: number) => {
    const visual = visuals.get(id);
    if (!visual) return;
    scene.remove(visual.model.group);
    for (const material of visual.model.materials) material.dispose();
    for (const geometry of visual.model.geometries) geometry.dispose();
    for (const material of visual.healthBar?.materials ?? []) material.dispose();
    visuals.delete(id);
  };

  return {
    sync(mobs, timeMs) {
      seen.clear();
      for (const mob of mobs) {
        seen.add(mob.id);
        let visual = visuals.get(mob.id);
        if (!visual) {
          const model = createMobModelForKind(mob.kind);
          const healthBar = mob.hostile ? createHealthBar(mob.kind) : null;
          if (healthBar) model.group.add(healthBar.group);
          visual = { model, healthBar };
          visuals.set(mob.id, visual);
          scene.add(model.group);
        }
        const { model, healthBar } = visual;

        // A told-to-stay pet sits still: no bob, hunkered down, legs at rest.
        const bob = mob.sitting ? 0 : Math.sin(timeMs * 0.008 + mob.bobSeed) * 0.04;
        model.group.position.set(mob.position.x, mob.position.y + bob, mob.position.z);
        model.group.rotation.y = mob.yaw;

        // A primed creeper swells and flashes white as its fuse burns down.
        let scale = mob.ageTimer > 0 ? BABY_SCALE : 1;
        if (mob.kind === "creeper") {
          const primed = (mob.fuseTimer ?? 0) > 0;
          const wave = 0.5 + 0.5 * Math.sin(timeMs * 0.025);
          if (primed) scale *= 1 + 0.18 * wave;
          const flash = primed ? 0.35 + 0.55 * wave : 0;
          for (const material of model.materials) (material as THREE.MeshStandardMaterial).emissive.setScalar(flash);
        }
        if (mob.sitting) scale *= 0.7;
        model.group.scale.setScalar(scale);

        if (healthBar) {
          const hpPercent = Math.max(0, Math.min(1, mob.hp / MOB_TEMPLATES[mob.kind].hp));
          healthBar.fill.scale.x = healthBar.width * hpPercent;
          healthBar.fill.position.x = -(healthBar.width - healthBar.fill.scale.x) * 0.5;
        }

        const gait = mob.sitting ? 0 : Math.sin(timeMs * 0.015 * mob.moveSpeed + mob.bobSeed) * 0.3;
        if (model.legs.length === 4) {
          model.legs[0].rotation.x = gait;
          model.legs[1].rotation.x = -gait;
          model.legs[2].rotation.x = -gait;
          model.legs[3].rotation.x = gait;
        }
      }

      for (const id of visuals.keys()) {
        if (!seen.has(id)) removeModel(id);
      }
    },

    dispose() {
      for (const id of [...visuals.keys()]) removeModel(id);
    }
  };
}
