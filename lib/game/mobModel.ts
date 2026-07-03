import * as THREE from "three";
import type { MobModel } from "@/lib/game/types";

export function createMobModel(
  bodyColor: number,
  headColor: number,
  legColor: number,
  eyeColor: number,
  detailColor: number,
  bodySize: [number, number, number],
  headSize: [number, number, number],
  variant: "quadruped" | "fish" = "quadruped"
): MobModel {
  const group = new THREE.Group();
  const materials = [
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.86, metalness: 0.02 }),
    new THREE.MeshStandardMaterial({ color: headColor, roughness: 0.84, metalness: 0.02 }),
    new THREE.MeshStandardMaterial({ color: legColor, roughness: 0.9, metalness: 0.02 }),
    new THREE.MeshStandardMaterial({ color: eyeColor, roughness: 0.3, metalness: 0.05, emissive: new THREE.Color(eyeColor).multiplyScalar(0.15) }),
    new THREE.MeshStandardMaterial({ color: detailColor, roughness: 0.82, metalness: 0.02 })
  ];

  if (variant === "fish") return createFishModel(group, materials, bodySize, headSize);

  const bodyGeo = new THREE.BoxGeometry(bodySize[0], bodySize[1], bodySize[2]);
  const headGeo = new THREE.BoxGeometry(headSize[0], headSize[1], headSize[2]);
  const legGeo = new THREE.BoxGeometry(Math.max(0.12, bodySize[0] * 0.2), Math.max(0.3, bodySize[1] * 0.56), Math.max(0.12, bodySize[2] * 0.2));
  const eyeGeo = new THREE.BoxGeometry(Math.max(0.05, headSize[0] * 0.13), Math.max(0.05, headSize[1] * 0.13), Math.max(0.03, headSize[2] * 0.1));

  const body = new THREE.Mesh(bodyGeo, materials[0]);
  body.position.y = bodySize[1] * 0.5;

  const head = new THREE.Mesh(headGeo, materials[1]);
  head.position.set(0, bodySize[1] * 0.88, bodySize[2] * 0.45);

  const eyeL = new THREE.Mesh(eyeGeo, materials[3]);
  eyeL.position.set(-headSize[0] * 0.2, head.position.y + headSize[1] * 0.05, head.position.z + headSize[2] * 0.47);
  const eyeR = new THREE.Mesh(eyeGeo, materials[3]);
  eyeR.position.set(headSize[0] * 0.2, head.position.y + headSize[1] * 0.05, head.position.z + headSize[2] * 0.47);

  const snoutGeo = new THREE.BoxGeometry(headSize[0] * 0.5, headSize[1] * 0.33, headSize[2] * 0.36);
  const snout = new THREE.Mesh(snoutGeo, materials[4]);
  snout.position.set(0, head.position.y - headSize[1] * 0.1, head.position.z + headSize[2] * 0.62);

  const stripeGeo = new THREE.BoxGeometry(bodySize[0] * 0.72, bodySize[1] * 0.2, bodySize[2] * 0.24);
  const stripe = new THREE.Mesh(stripeGeo, materials[4]);
  stripe.position.set(0, body.position.y + bodySize[1] * 0.35, 0);

  group.add(body, head, eyeL, eyeR, snout, stripe);

  const legs: THREE.Mesh[] = [];
  const legY = legGeo.parameters.height * 0.5;
  const offsets = [
    [-bodySize[0] * 0.28, legY, -bodySize[2] * 0.25],
    [bodySize[0] * 0.28, legY, -bodySize[2] * 0.25],
    [-bodySize[0] * 0.28, legY, bodySize[2] * 0.25],
    [bodySize[0] * 0.28, legY, bodySize[2] * 0.25]
  ];

  for (const offset of offsets) {
    const leg = new THREE.Mesh(legGeo, materials[2]);
    leg.position.set(offset[0], offset[1], offset[2]);
    legs.push(leg);
    group.add(leg);
  }

  return {
    group,
    legs,
    halfHeight: Math.max(bodySize[1], legGeo.parameters.height) * 0.5 + 0.2,
    materials,
    geometries: [bodyGeo, headGeo, legGeo, eyeGeo, snoutGeo, stripeGeo]
  };
}

/**
 * A legless swimmer: a flat elongated body centered on the group origin (fish
 * hover at their body center, not on legs), a vertical tail fin behind, a small
 * dorsal fin on top, and side eyes near the front. `headSize` sizes the fins.
 * No legs, so the gait animation in mobVisuals leaves it rigid, and its
 * halfHeight mirrors mobHalfHeight's fish branch (body only, no leg clearance).
 */
function createFishModel(
  group: THREE.Group,
  materials: THREE.MeshStandardMaterial[],
  bodySize: [number, number, number],
  headSize: [number, number, number]
): MobModel {
  const bodyGeo = new THREE.BoxGeometry(bodySize[0], bodySize[1], bodySize[2]);
  const body = new THREE.Mesh(bodyGeo, materials[0]);

  const tailGeo = new THREE.BoxGeometry(Math.max(0.04, bodySize[0] * 0.18), headSize[1], headSize[2]);
  const tail = new THREE.Mesh(tailGeo, materials[4]);
  tail.position.set(0, 0, -bodySize[2] * 0.5 - headSize[2] * 0.4);

  const finGeo = new THREE.BoxGeometry(Math.max(0.04, bodySize[0] * 0.18), headSize[1] * 0.6, headSize[2] * 0.7);
  const fin = new THREE.Mesh(finGeo, materials[2]);
  fin.position.set(0, bodySize[1] * 0.5 + headSize[1] * 0.25, -bodySize[2] * 0.1);

  const eyeGeo = new THREE.BoxGeometry(Math.max(0.03, bodySize[0] * 0.15), Math.max(0.04, bodySize[1] * 0.18), Math.max(0.04, bodySize[1] * 0.18));
  const eyeL = new THREE.Mesh(eyeGeo, materials[3]);
  eyeL.position.set(-bodySize[0] * 0.5, bodySize[1] * 0.15, bodySize[2] * 0.32);
  const eyeR = new THREE.Mesh(eyeGeo, materials[3]);
  eyeR.position.set(bodySize[0] * 0.5, bodySize[1] * 0.15, bodySize[2] * 0.32);

  group.add(body, tail, fin, eyeL, eyeR);

  return {
    group,
    legs: [],
    halfHeight: bodySize[1] * 0.5 + 0.05,
    materials,
    geometries: [bodyGeo, tailGeo, finGeo, eyeGeo]
  };
}
