import * as THREE from "three";

/**
 * The player's own body, visible only in third person. Box-mesh humanoid in
 * the same zero-asset style as the mobs, but with two arms and pivot groups at
 * the shoulders/hips so limbs swing about their joints instead of their
 * centers. The group origin sits at the feet and the face is built on the -Z
 * side, so `group.rotation.y = player.yaw` matches the camera convention
 * (forward at yaw 0 is -Z).
 */
export type PlayerModel = {
  group: THREE.Group;
  /** Neck pivot — apply the look pitch here so the body stays upright. */
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  /** Hand anchor inside the right arm — the held item model goes here. */
  itemHolder: THREE.Group;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
};

const SKIN = 0xc68e63;
const HAIR = 0x4a3220;
const SHIRT = 0x2e8b83;
const PANTS = 0x3b3f8f;
const SHOES = 0x4a3527;
const EYE_WHITE = 0xffffff;
const EYE_PUPIL = 0x2b2b45;

export function createPlayerModel(): PlayerModel {
  const group = new THREE.Group();
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];

  const material = (color: number) => {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02 });
    materials.push(mat);
    return mat;
  };
  const box = (w: number, h: number, d: number, mat: THREE.Material) => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometries.push(geometry);
    return new THREE.Mesh(geometry, mat);
  };

  const skinMat = material(SKIN);
  const shirtMat = material(SHIRT);
  const pantsMat = material(PANTS);
  const shoeMat = material(SHOES);

  // Legs: hip pivots at y=0.72, meshes hanging below (pants + shoe band).
  const makeLeg = (x: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.72, 0);
    const leg = box(0.2, 0.6, 0.2, pantsMat);
    leg.position.y = -0.36;
    const shoe = box(0.21, 0.12, 0.22, shoeMat);
    shoe.position.set(0, -0.66, 0.005);
    pivot.add(leg, shoe);
    group.add(pivot);
    return pivot;
  };
  const leftLeg = makeLeg(-0.11);
  const rightLeg = makeLeg(0.11);

  // Torso spans y 0.72–1.32.
  const torso = box(0.46, 0.6, 0.24, shirtMat);
  torso.position.y = 1.02;
  group.add(torso);

  // Arms: shoulder pivots just below the torso top; bare skin like Steve.
  const makeArm = (x: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.26, 0);
    const arm = box(0.16, 0.66, 0.16, skinMat);
    arm.position.y = -0.33;
    pivot.add(arm);
    group.add(pivot);
    return pivot;
  };
  const leftArm = makeArm(-0.31);
  const rightArm = makeArm(0.31);
  rightArm.name = "rightArm";

  // Hand anchor at the end of the right arm, tilted slightly forward so held
  // items read as carried rather than glued flat to the limb.
  const itemHolder = new THREE.Group();
  itemHolder.name = "itemHolder";
  itemHolder.position.set(0, -0.62, -0.1);
  itemHolder.rotation.x = -0.5;
  itemHolder.scale.setScalar(0.8);
  rightArm.add(itemHolder);

  // Head on a neck pivot; the face (eyes) is on the -Z side.
  const head = new THREE.Group();
  head.name = "head";
  head.position.set(0, 1.32, 0);
  const skull = box(0.4, 0.4, 0.4, skinMat);
  skull.position.y = 0.23;
  const hair = box(0.42, 0.12, 0.42, material(HAIR));
  hair.position.y = 0.4;
  head.add(skull, hair);
  const eyeWhite = material(EYE_WHITE);
  const eyePupil = material(EYE_PUPIL);
  for (const side of [-1, 1]) {
    const white = box(0.09, 0.07, 0.02, eyeWhite);
    white.position.set(side * 0.09, 0.26, -0.2);
    const pupil = box(0.04, 0.07, 0.02, eyePupil);
    pupil.position.set(side * 0.07, 0.26, -0.205);
    head.add(white, pupil);
  }
  group.add(head);

  return { group, head, leftArm, rightArm, leftLeg, rightLeg, itemHolder, materials, geometries };
}
