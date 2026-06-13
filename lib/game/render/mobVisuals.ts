import * as THREE from "three";
import { BABY_SCALE } from "@/lib/game/config";
import { createMobModelForKind } from "@/lib/game/mobs";
import type { MobModel } from "@/lib/game/types";
import type { MobState } from "@/lib/game/engine/state";

export type MobVisuals = {
  /** Creates/removes models to match the mob list and animates bob + gait. */
  sync(mobs: MobState[], timeMs: number): void;
  dispose(): void;
};

export function createMobVisuals(scene: THREE.Scene): MobVisuals {
  const models = new Map<number, MobModel>();
  const seen = new Set<number>();

  const removeModel = (id: number) => {
    const model = models.get(id);
    if (!model) return;
    scene.remove(model.group);
    for (const material of model.materials) material.dispose();
    for (const geometry of model.geometries) geometry.dispose();
    models.delete(id);
  };

  return {
    sync(mobs, timeMs) {
      seen.clear();
      for (const mob of mobs) {
        seen.add(mob.id);
        let model = models.get(mob.id);
        if (!model) {
          model = createMobModelForKind(mob.kind);
          models.set(mob.id, model);
          scene.add(model.group);
        }

        const bob = Math.sin(timeMs * 0.008 + mob.bobSeed) * 0.04;
        model.group.position.set(mob.position.x, mob.position.y + bob, mob.position.z);
        model.group.rotation.y = mob.yaw;
        model.group.scale.setScalar(mob.ageTimer > 0 ? BABY_SCALE : 1);

        const gait = Math.sin(timeMs * 0.015 * mob.moveSpeed + mob.bobSeed) * 0.3;
        if (model.legs.length === 4) {
          model.legs[0].rotation.x = gait;
          model.legs[1].rotation.x = -gait;
          model.legs[2].rotation.x = -gait;
          model.legs[3].rotation.x = gait;
        }
      }

      for (const id of models.keys()) {
        if (!seen.has(id)) removeModel(id);
      }
    },

    dispose() {
      for (const id of [...models.keys()]) removeModel(id);
    }
  };
}
