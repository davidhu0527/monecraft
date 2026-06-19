import * as THREE from "three";
import type { FishingState } from "@/lib/game/engine/state";

export type BobberVisuals = {
  /**
   * Animates the bobber + line each frame: it arcs out from the rod tip on a cast,
   * bobs on the water while waiting (dipping on a bite), and arcs back to the rod
   * tip on reel-in. Driven by the `state.fishing` null↔set edges (so a silent
   * cancel still plays the reel-back) plus the per-frame `dtMs`.
   */
  sync(fishing: FishingState | null, rodTip: THREE.Vector3, dtMs: number): void;
  dispose(): void;
};

const CAST_S = 0.35; // bobber flight time, cast
const REEL_S = 0.25; // bobber flight time, reel
const LOB_HEIGHT = 0.9; // peak of the cast parabola above the straight-line path
const BOB_AMP = 0.04; // idle bob amplitude on the water
const BOB_HZ = 1.1; // idle bob frequency
const BITE_DIP = -0.09; // the strike pulls the float under

type Phase = "hidden" | "casting" | "waiting" | "reeling";

/**
 * Renders the single active fishing bobber as a small red float on a line from the
 * rod tip. One mesh + one line, added to the scene only while a cast is in flight
 * or on the water, removed once the reel-back finishes or on dispose().
 */
export function createBobberVisuals(scene: THREE.Scene): BobberVisuals {
  const bobberGeometry = new THREE.SphereGeometry(0.11, 8, 6);
  const bobberMaterial = new THREE.MeshStandardMaterial({ color: 0xd03c34, roughness: 0.5 });
  const bobber = new THREE.Mesh(bobberGeometry, bobberMaterial);
  // It travels far from its cached bounds during the arc — don't let culling drop it.
  bobber.frustumCulled = false;

  const linePositions = new Float32Array(6);
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0xdedede });
  const line = new THREE.Line(lineGeometry, lineMaterial);
  line.frustumCulled = false;

  let present = false;
  const setPresent = (next: boolean): void => {
    if (next === present) return;
    present = next;
    if (next) scene.add(bobber, line);
    else scene.remove(bobber, line);
  };

  let phase: Phase = "hidden";
  let t = 0; // seconds elapsed in the current phase
  let wasFishing = false;
  const castFrom = new THREE.Vector3();
  const target = new THREE.Vector3();
  const reelFrom = new THREE.Vector3();
  const cur = new THREE.Vector3();
  const lastBobber = new THREE.Vector3();

  return {
    sync(fishing, rodTip, dtMs) {
      const dt = dtMs / 1000;
      const isFishing = fishing !== null;

      // Cast (null -> set): arc out from the rod tip. Reel (set -> null, including
      // a silent cancel that emits no event): arc back to the rod tip.
      if (isFishing && !wasFishing) {
        phase = "casting";
        t = 0;
        castFrom.copy(rodTip);
        target.copy(fishing.position);
      } else if (!isFishing && wasFishing) {
        phase = "reeling";
        t = 0;
        reelFrom.copy(lastBobber);
      }
      wasFishing = isFishing;

      if (phase === "hidden") {
        setPresent(false);
        return;
      }

      t += dt;

      if (phase === "casting") {
        if (fishing) target.copy(fishing.position);
        const k = Math.min(1, t / CAST_S);
        cur.lerpVectors(castFrom, target, k);
        cur.y += Math.sin(k * Math.PI) * LOB_HEIGHT;
        if (k >= 1) {
          phase = "waiting";
          t = 0;
        }
      } else if (phase === "waiting" && fishing) {
        cur.copy(fishing.position);
        cur.y += Math.sin(t * BOB_HZ * Math.PI * 2) * BOB_AMP;
        if (fishing.biting) cur.y += BITE_DIP;
      } else if (phase === "reeling") {
        const k = Math.min(1, t / REEL_S);
        cur.lerpVectors(reelFrom, rodTip, k); // reel toward the live rod tip
        cur.y += Math.sin(k * Math.PI) * (LOB_HEIGHT * 0.4);
        if (k >= 1) {
          phase = "hidden";
          setPresent(false);
          return;
        }
      }

      setPresent(true);
      bobber.position.copy(cur);
      lastBobber.copy(cur); // so the set->null edge can capture the live position
      linePositions[0] = rodTip.x;
      linePositions[1] = rodTip.y;
      linePositions[2] = rodTip.z;
      linePositions[3] = cur.x;
      linePositions[4] = cur.y;
      linePositions[5] = cur.z;
      lineGeometry.attributes.position.needsUpdate = true;
    },

    dispose() {
      setPresent(false);
      bobberGeometry.dispose();
      bobberMaterial.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
    }
  };
}
