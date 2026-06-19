import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { createBobberVisuals } from "@/lib/game/render/bobberVisuals";
import type { FishingState } from "@/lib/game/engine/state";

const TIP = new THREE.Vector3(0, 2, 0);
const fishing = (biting = false): FishingState => ({ position: new THREE.Vector3(5, 1, 5), timer: 3, biting });
const meshOf = (scene: THREE.Scene) => scene.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh;
const lineOf = (scene: THREE.Scene) => scene.children.find((c) => (c as THREE.Line).isLine) as THREE.Line;

describe("bobberVisuals", () => {
  test("stays hidden while not fishing", () => {
    const scene = new THREE.Scene();
    const v = createBobberVisuals(scene);
    v.sync(null, TIP, 16);
    expect(scene.children).toHaveLength(0);
    v.dispose();
  });

  test("appears on a cast and is removed after the full reel-back", () => {
    const scene = new THREE.Scene();
    const v = createBobberVisuals(scene);

    v.sync(fishing(), TIP, 16); // cast begins → bobber + line present
    expect(scene.children).toHaveLength(2);

    v.sync(fishing(), TIP, 1000); // cast lands → waiting
    expect(scene.children).toHaveLength(2);

    v.sync(null, TIP, 16); // fishing→null edge starts the reel (no event needed)
    expect(scene.children).toHaveLength(2);

    v.sync(null, TIP, 1000); // reel finishes → hidden
    expect(scene.children).toHaveLength(0);
    v.dispose();
  });

  test("the cast arcs above the straight-line path", () => {
    const scene = new THREE.Scene();
    const v = createBobberVisuals(scene);
    v.sync(fishing(), TIP, 175); // start + advance to ~mid-flight (CAST_S 0.35s)
    // Linear midpoint between tip(y=2) and water(y=1) is 1.5; the lob lifts it well above.
    expect(meshOf(scene).position.y).toBeGreaterThan(2);
    v.dispose();
  });

  test("settles on the water surface after the cast lands", () => {
    const scene = new THREE.Scene();
    const v = createBobberVisuals(scene);
    v.sync(fishing(), TIP, 16);
    v.sync(fishing(), TIP, 1000); // cast complete
    v.sync(fishing(), TIP, 16); // a waiting frame
    const bob = meshOf(scene);
    expect(bob.position.x).toBe(5);
    expect(bob.position.z).toBe(5);
    expect(Math.abs(bob.position.y - 1)).toBeLessThanOrEqual(0.05); // at the surface, within the bob
    v.dispose();
  });

  test("a bite dips the float lower than the idle bob", () => {
    const calm = createBobberVisuals(new THREE.Scene());
    const biting = createBobberVisuals(new THREE.Scene());
    const land = (v: ReturnType<typeof createBobberVisuals>, f: FishingState, s: THREE.Scene) => {
      v.sync(f, TIP, 16);
      v.sync(f, TIP, 1000);
      v.sync(f, TIP, 16);
      return meshOf(s);
    };
    const calmScene = new THREE.Scene();
    const biteScene = new THREE.Scene();
    const calmBob = land(createBobberVisuals(calmScene), fishing(false), calmScene);
    const biteBob = land(createBobberVisuals(biteScene), fishing(true), biteScene);
    expect(biteBob.position.y).toBeLessThan(calmBob.position.y);
    calm.dispose();
    biting.dispose();
  });

  test("draws the line from the rod tip to the bobber", () => {
    const scene = new THREE.Scene();
    const v = createBobberVisuals(scene);
    const tip = new THREE.Vector3(1, 3, 1);
    v.sync(fishing(), tip, 1000); // lands at the water target this frame
    const pos = lineOf(scene).geometry.getAttribute("position");
    expect([pos.getX(0), pos.getY(0), pos.getZ(0)]).toEqual([1, 3, 1]); // rod tip
    expect([pos.getX(1), pos.getY(1), pos.getZ(1)]).toEqual([5, 1, 5]); // bobber on the water
    v.dispose();
  });
});
