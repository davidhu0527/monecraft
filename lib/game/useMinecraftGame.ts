"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { BiomeId, BlockId, collidesAt, createBlockAtlasTexture, VoxelWorld, WORLD_SIZE_X, WORLD_SIZE_Y, WORLD_SIZE_Z } from "@/lib/world";
import { readSave } from "@/lib/game/save";
import { tickDayNight } from "@/lib/game/runtime/dayNight";
import { bindGameInput } from "@/lib/game/runtime/input";
import { spawnMobGroup, tickMobs } from "@/lib/game/runtime/mobs";
import { doPlace, processMining, tryAttackMob, weaponDamage } from "@/lib/game/runtime/miningCombat";
import { createPersistenceHandlers } from "@/lib/game/runtime/persistence";
import { createApplyDamage, tickDeathAndRespawn } from "@/lib/game/runtime/playerLife";
import { tickPlayerMovement } from "@/lib/game/runtime/playerMotion";
import { createSurfaceYAt, randomLandPointNear as pickRandomLandPointNear } from "@/lib/game/runtime/spawn";
import {
  ARMOR_SLOTS,
  BLOCK_TO_SLOT,
  CROUCH_SPEED,
  createEmptyArmorEquipment,
  createEmptySlot,
  createInitialInventory,
  createSlot,
  EYE_HEIGHT,
  GRAVITY,
  HOTBAR_SLOTS,
  INVENTORY_SLOTS,
  ITEM_DEF_BY_ID,
  JUMP_VELOCITY,
  MAX_ENERGY,
  MAX_HEARTS,
  MAX_STACK_SIZE,
  PLAYER_HEIGHT,
  PLAYER_HALF_WIDTH,
  RECIPES,
  RENDER_GRID,
  RENDER_RADIUS,
  SAVE_KEY,
  SPRINT_SPEED,
  WALK_SPEED
} from "@/lib/game/config";
import type { EquippedArmor, InventorySlot, MobEntity, Recipe, SaveDataV1 } from "@/lib/game/types";

export function useMinecraftGame() {
  const initialInventory = useMemo(() => createInitialInventory(), []);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const selectedSlotRef = useRef(0);
  const capsActiveRef = useRef(false);
  const inventoryRef = useRef<InventorySlot[]>(initialInventory);
  const equippedArmorRef = useRef<EquippedArmor>(createEmptyArmorEquipment());
  const inventoryOpenRef = useRef(false);
  const heartsRef = useRef(MAX_HEARTS);
  const energyRef = useRef(MAX_ENERGY);
  const isDeadRef = useRef(false);
  const respawnTimerRef = useRef(0);
  const respawnShownRef = useRef(0);
  const leftMouseHeldRef = useRef(false);
  const mineProgressRef = useRef(0);
  const mineTargetRef = useRef<string>("");
  const saveNowRef = useRef<(() => void) | null>(null);
  const loadNowRef = useRef<(() => void) | null>(null);
  const resetNowRef = useRef<(() => void) | null>(null);

  const [locked, setLocked] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [capsActive, setCapsActive] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [inventory, setInventory] = useState<InventorySlot[]>(initialInventory);
  const [equippedArmor, setEquippedArmor] = useState<EquippedArmor>(createEmptyArmorEquipment());
  const [hearts, setHearts] = useState(MAX_HEARTS);
  const [energy, setEnergy] = useState(MAX_ENERGY);
  const [daylightPercent, setDaylightPercent] = useState(100);
  const [passiveCount, setPassiveCount] = useState(0);
  const [hostileCount, setHostileCount] = useState(0);
  const [respawnSeconds, setRespawnSeconds] = useState(0);
  const [saveMessage, setSaveMessage] = useState("");

  const heartDisplay = useMemo(() => Array.from({ length: MAX_HEARTS }, (_, i) => i < hearts), [hearts]);

  useEffect(() => {
    selectedSlotRef.current = selectedSlot;
  }, [selectedSlot]);

  useEffect(() => {
    capsActiveRef.current = capsActive;
  }, [capsActive]);

  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);

  useEffect(() => {
    equippedArmorRef.current = equippedArmor;
  }, [equippedArmor]);

  useEffect(() => {
    inventoryOpenRef.current = inventoryOpen;
  }, [inventoryOpen]);

  useEffect(() => {
    energyRef.current = energy;
  }, [energy]);

  useEffect(() => {
    setEquippedArmor((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const armorSlot of ARMOR_SLOTS) {
        const equippedId = next[armorSlot];
        if (!equippedId) continue;
        const stillOwned = inventory.some((slot) => slot.id === equippedId && slot.count > 0);
        if (stillOwned) continue;
        next[armorSlot] = null;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [inventory]);

  const cloneSlot = (slot: InventorySlot): InventorySlot => ({ ...slot });

  const armorReductionFromInventory = (slots: InventorySlot[], equipped: EquippedArmor): number => {
    let defense = 0;
    for (const armorSlot of ARMOR_SLOTS) {
      const equippedId = equipped[armorSlot];
      if (!equippedId) continue;
      const def = ITEM_DEF_BY_ID[equippedId];
      if (!def || def.kind !== "armor" || def.armorSlot !== armorSlot) continue;
      const hasOwnedPiece = slots.some((slot) => slot.id === equippedId && slot.count > 0);
      if (!hasOwnedPiece) continue;
      defense += def.defense ?? 0;
    }
    return Math.min(0.75, defense * 0.05);
  };

  const toggleEquipArmor = (inventoryIndex: number) => {
    if (inventoryIndex < 0 || inventoryIndex >= INVENTORY_SLOTS) return;
    const slot = inventoryRef.current[inventoryIndex];
    if (slot.kind !== "armor" || !slot.id || !slot.armorSlot || slot.count <= 0) return;
    const slotId = slot.id;
    const armorSlot = slot.armorSlot;
    setEquippedArmor((prev) => {
      const next = { ...prev };
      next[armorSlot] = prev[armorSlot] === slotId ? null : slotId;
      return next;
    });
  };

  const countsById = (slots: InventorySlot[]): Map<string, number> => {
    const byId = new Map<string, number>();
    for (const slot of slots) {
      if (!slot.id || slot.count <= 0) continue;
      byId.set(slot.id, (byId.get(slot.id) ?? 0) + slot.count);
    }
    return byId;
  };

  const adjustSlotCount = (slotId: string, delta: number, preferredIndex?: number) => {
    if (!slotId || delta === 0) return;
    setInventory((prev) => {
      const next = prev.map(cloneSlot);
      let remaining = Math.abs(delta);

      if (delta < 0) {
        const consumeFromIndex = (index: number) => {
          if (remaining <= 0) return;
          if (index < 0 || index >= next.length) return;
          const slot = next[index];
          if (slot.id !== slotId || slot.count <= 0) return;
          const take = Math.min(remaining, slot.count);
          slot.count -= take;
          remaining -= take;
          if (slot.count <= 0) next[index] = createEmptySlot();
        };

        if (typeof preferredIndex === "number") consumeFromIndex(preferredIndex);
        for (let i = 0; i < next.length && remaining > 0; i += 1) consumeFromIndex(i);
        if (remaining > 0) return prev;
        return next;
      }

      if (!ITEM_DEF_BY_ID[slotId]) return prev;

      const fillIndex = (index: number) => {
        if (remaining <= 0) return;
        if (index < 0 || index >= next.length) return;
        const slot = next[index];
        if (slot.id !== slotId || slot.count >= MAX_STACK_SIZE) return;
        const add = Math.min(remaining, MAX_STACK_SIZE - slot.count);
        slot.count += add;
        remaining -= add;
      };

      if (typeof preferredIndex === "number") fillIndex(preferredIndex);
      for (let i = 0; i < next.length && remaining > 0; i += 1) fillIndex(i);
      for (let i = 0; i < next.length && remaining > 0; i += 1) {
        if (next[i].id !== null || next[i].count !== 0) continue;
        const add = Math.min(remaining, MAX_STACK_SIZE);
        next[i] = createSlot(slotId, add);
        remaining -= add;
      }
      return next;
    });
  };

  const canCraft = (recipe: Recipe): boolean => {
    const slots = inventoryRef.current;
    const byId = countsById(slots);
    const hasCost = recipe.cost.every((cost) => (byId.get(cost.slotId) ?? 0) >= cost.count);
    if (!hasCost) return false;

    let freeForResult = 0;
    for (const slot of slots) {
      if (slot.id === recipe.result.slotId) freeForResult += MAX_STACK_SIZE - slot.count;
      if (slot.id === null && slot.count === 0) freeForResult += MAX_STACK_SIZE;
    }
    return freeForResult >= recipe.result.count;
  };

  const craft = (recipe: Recipe) => {
    setInventory((prev) => {
      const byId = countsById(prev);
      const allowed = recipe.cost.every((cost) => (byId.get(cost.slotId) ?? 0) >= cost.count);
      if (!allowed) return prev;

      const next = prev.map(cloneSlot);
      for (const cost of recipe.cost) {
        let remaining = cost.count;
        for (let i = 0; i < next.length && remaining > 0; i += 1) {
          if (next[i].id !== cost.slotId || next[i].count <= 0) continue;
          const take = Math.min(remaining, next[i].count);
          next[i].count -= take;
          remaining -= take;
          if (next[i].count <= 0) next[i] = createEmptySlot();
        }
      }

      if (!ITEM_DEF_BY_ID[recipe.result.slotId]) return next;
      let remaining = recipe.result.count;

      for (let i = 0; i < next.length && remaining > 0; i += 1) {
        if (next[i].id !== recipe.result.slotId || next[i].count >= MAX_STACK_SIZE) continue;
        const add = Math.min(remaining, MAX_STACK_SIZE - next[i].count);
        next[i].count += add;
        remaining -= add;
      }
      for (let i = 0; i < next.length && remaining > 0; i += 1) {
        if (next[i].id !== null || next[i].count !== 0) continue;
        const add = Math.min(remaining, MAX_STACK_SIZE);
        next[i] = createSlot(recipe.result.slotId, add);
        remaining -= add;
      }
      return next;
    });
  };

  const swapInventorySlots = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setInventory((prev) => {
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= prev.length || toIndex >= prev.length) return prev;
      const next = prev.map(cloneSlot);
      const temp = next[fromIndex];
      next[fromIndex] = next[toIndex];
      next[toIndex] = temp;
      return next;
    });
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const loadedSave: SaveDataV1 | null = readSave(SAVE_KEY);

    const worldSeed = loadedSave?.seed ?? Math.floor(Math.random() * 2147483647);
    const world = new VoxelWorld(WORLD_SIZE_X, WORLD_SIZE_Y, WORLD_SIZE_Z, worldSeed);
    world.generate();

    const changedBlocks = new Map<number, number>();
    const baselineByIndex = new Map<number, number>();

    if (loadedSave) {
      for (const [idx, block] of loadedSave.changes) {
        const layer = world.sizeX * world.sizeZ;
        const y = Math.floor(idx / layer);
        const rem = idx - y * layer;
        const z = Math.floor(rem / world.sizeX);
        const x = rem - z * world.sizeX;
        if (!world.inBounds(x, y, z)) continue;
        world.set(x, y, z, block as BlockId);
        changedBlocks.set(idx, block);
      }
    }

    const scene = new THREE.Scene();
    const daySky = new THREE.Color(0x8bc2ff);
    const nightSky = new THREE.Color(0x06111f);
    const liveSky = new THREE.Color(0x8bc2ff);
    scene.background = liveSky;
    scene.fog = new THREE.Fog(liveSky, 30, 200);

    const camera = new THREE.PerspectiveCamera(75, mount.clientWidth / mount.clientHeight, 0.1, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const hemiLight = new THREE.HemisphereLight(0xd7efff, 0x9a907f, 1.18);
    scene.add(hemiLight);

    const sun = new THREE.DirectionalLight(0xfff4da, 1.28);
    sun.position.set(40, 95, 24);
    scene.add(sun);

    const worldMaterial = new THREE.MeshStandardMaterial({
      map: createBlockAtlasTexture(),
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.02
    });
    let worldMesh = new THREE.Mesh(new THREE.BufferGeometry(), worldMaterial);
    scene.add(worldMesh);
    scene.add(camera);

    const pointer = new THREE.Vector2(0, 0);
    const raycaster = new THREE.Raycaster();

    const controls = {
      yaw: 0,
      pitch: 0,
      keys: new Set<string>()
    };

        const spawnX = Math.floor(world.sizeX / 2);
        const spawnZ = Math.floor(world.sizeZ / 2);
        const findSpawnOnLand = (centerX = spawnX, centerZ = spawnZ, seekPlains = true) => {
          const isGoodSpawn = (x: number, y: number, z: number): boolean => {
            const top = world.get(x, y - 1, z);
            const atBody = world.get(x, y, z);
            const atHead = world.get(x, y + 1, z);
            if (!world.isSolid(x, y - 1, z)) return false;
            if (atBody === BlockId.Water || atHead === BlockId.Water || top === BlockId.Water) return false;
            if (atBody !== BlockId.Air || atHead !== BlockId.Air) return false;
            if (seekPlains && world.getBiome(x, z) !== BiomeId.Plains) return false;
    
            const h0 = world.highestSolidY(x + 1, z);
            const h1 = world.highestSolidY(x - 1, z);
            const h2 = world.highestSolidY(x, z + 1);
            const h3 = world.highestSolidY(x, z - 1);
            const ny = y - 1;
            return Math.abs(h0 - ny) <= 2 && Math.abs(h1 - ny) <= 2 && Math.abs(h2 - ny) <= 2 && Math.abs(h3 - ny) <= 2;
          };
    
          const maxRadius = Math.min(300, Math.floor(Math.min(world.sizeX, world.sizeZ) * 0.4));
          // Try to find a plain first
          for (let radius = 0; radius <= maxRadius; radius += 2) {
            for (let i = 0; i < 32; i += 1) {
              const angle = (Math.PI * 2 * i) / 32;
              const x = Math.max(5, Math.min(world.sizeX - 6, Math.floor(centerX + Math.cos(angle) * radius)));
              const z = Math.max(5, Math.min(world.sizeZ - 6, Math.floor(centerZ + Math.sin(angle) * radius)));
              const topY = world.highestSolidY(x, z);
              const y = topY + 1;
              if (isGoodSpawn(x, y, z)) return { x, y, z };
            }
          }
    
          // If no plain found, try any solid ground
          if (seekPlains) return findSpawnOnLand(centerX, centerZ, false);
    
          const topY = world.highestSolidY(centerX, centerZ);
          return { x: centerX, y: topY + 1, z: centerZ };
        };
    
        const firstSpawn = findSpawnOnLand();
        const player = {
          position: new THREE.Vector3(firstSpawn.x, firstSpawn.y, firstSpawn.z),
          velocity: new THREE.Vector3(),
          onGround: false
        };
        const forceUnstuck = (centerX = player.position.x, centerZ = player.position.z) => {
          const safe = findSpawnOnLand(centerX, centerZ, true);
          player.position.set(safe.x, safe.y, safe.z);
          player.velocity.set(0, 0, 0);
          player.onGround = false;
        };
    
        if (Array.isArray(loadedSave?.inventorySlots)) {
          const slots = Array.from({ length: INVENTORY_SLOTS }, () => createEmptySlot());
          for (let i = 0; i < Math.min(INVENTORY_SLOTS, loadedSave.inventorySlots.length); i += 1) {
            const saved = loadedSave.inventorySlots[i];
            if (!saved?.id || saved.count <= 0) continue;
            if (!ITEM_DEF_BY_ID[saved.id]) continue;
            slots[i] = createSlot(saved.id, Math.min(MAX_STACK_SIZE, Math.max(0, Math.floor(saved.count))));
          }
          setInventory(slots);
        } else if (loadedSave?.inventoryCounts) {
          const slots = Array.from({ length: INVENTORY_SLOTS }, () => createEmptySlot());
          let cursor = 0;
          for (const [id, raw] of Object.entries(loadedSave.inventoryCounts)) {
            if (!ITEM_DEF_BY_ID[id]) continue;
            let remaining = Math.max(0, Math.floor(raw));
            while (remaining > 0 && cursor < slots.length) {
              const add = Math.min(MAX_STACK_SIZE, remaining);
              slots[cursor] = createSlot(id, add);
              cursor += 1;
              remaining -= add;
            }
          }
          setInventory(slots);
        }
        if (typeof loadedSave?.selectedSlot === "number") {
          const idx = Math.max(0, Math.min(HOTBAR_SLOTS - 1, loadedSave.selectedSlot));
          setSelectedSlot(idx);
          selectedSlotRef.current = idx;
        }
        if (loadedSave?.equippedArmor) {
          const nextArmor = createEmptyArmorEquipment();
          for (const armorSlot of ARMOR_SLOTS) {
            const equippedId = loadedSave.equippedArmor[armorSlot];
            if (!equippedId) continue;
            const def = ITEM_DEF_BY_ID[equippedId];
            if (def?.kind !== "armor" || def.armorSlot !== armorSlot) continue;
            nextArmor[armorSlot] = equippedId;
          }
          setEquippedArmor(nextArmor);
          equippedArmorRef.current = nextArmor;
        }
        if (loadedSave?.player) {
          player.position.set(loadedSave.player.x, loadedSave.player.y, loadedSave.player.z);
        }
        // Safety check: if stuck after load, relocate to a plain
        if (
          collidesAt(world, player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT) ||
          player.position.y < 2 ||
          world.get(Math.floor(player.position.x), Math.floor(player.position.y), Math.floor(player.position.z)) === BlockId.Water
        ) {
          forceUnstuck(player.position.x, player.position.z);
        }
    

    const mobs: MobEntity[] = [];
    const disposables: Array<{ materials: THREE.Material[]; geometries: THREE.BufferGeometry[] }> = [];

    const surfaceYAt = createSurfaceYAt(world);
    const randomLandPointNear = (centerX: number, centerZ: number, radius: number) =>
      pickRandomLandPointNear(world, surfaceYAt, centerX, centerZ, radius);

    const spawnCenterX = player.position.x;
    const spawnCenterZ = player.position.z;
    const spawnRadius = RENDER_RADIUS * 0.7;
    spawnMobGroup({ kind: "sheep", hostile: false, count: 14, centerX: spawnCenterX, centerZ: spawnCenterZ, radius: spawnRadius, scene, mobs, disposables, randomLandPointNear });
    spawnMobGroup({ kind: "chicken", hostile: false, count: 12, centerX: spawnCenterX, centerZ: spawnCenterZ, radius: spawnRadius, scene, mobs, disposables, randomLandPointNear });
    spawnMobGroup({ kind: "horse", hostile: false, count: 8, centerX: spawnCenterX, centerZ: spawnCenterZ, radius: spawnRadius, scene, mobs, disposables, randomLandPointNear });
    spawnMobGroup({ kind: "zombie", hostile: true, count: 8, centerX: spawnCenterX, centerZ: spawnCenterZ, radius: spawnRadius, scene, mobs, disposables, randomLandPointNear });
    spawnMobGroup({ kind: "skeleton", hostile: true, count: 6, centerX: spawnCenterX, centerZ: spawnCenterZ, radius: spawnRadius, scene, mobs, disposables, randomLandPointNear });
    spawnMobGroup({ kind: "spider", hostile: true, count: 6, centerX: spawnCenterX, centerZ: spawnCenterZ, radius: spawnRadius, scene, mobs, disposables, randomLandPointNear });

    setPassiveCount(mobs.filter((mob) => !mob.hostile).length);
    setHostileCount(mobs.filter((mob) => mob.hostile).length);

    const updateCamera = () => {
      camera.position.set(player.position.x, player.position.y + EYE_HEIGHT, player.position.z);
      camera.rotation.order = "YXZ";
      camera.rotation.y = controls.yaw;
      camera.rotation.x = controls.pitch;
    };

    const heldRoot = new THREE.Group();
    camera.add(heldRoot);
    const heldGeometries: THREE.BufferGeometry[] = [];
    const heldMaterials: THREE.Material[] = [];
    let heldMesh: THREE.Object3D | null = null;
    let heldKey = "";

    const clearHeldItem = () => {
      if (heldMesh) heldRoot.remove(heldMesh);
      heldMesh = null;
      heldKey = "";
      while (heldGeometries.length) heldGeometries.pop()?.dispose();
      while (heldMaterials.length) heldMaterials.pop()?.dispose();
    };

    const blockColor = (blockId: BlockId | undefined): number => {
      switch (blockId) {
        case BlockId.Grass:
          return 0x5ea74a;
        case BlockId.Dirt:
          return 0x7f5d3d;
        case BlockId.Stone:
          return 0x8f9296;
        case BlockId.Wood:
          return 0x8d653d;
        case BlockId.Planks:
          return 0xbe965d;
        case BlockId.Cobblestone:
          return 0x787c82;
        case BlockId.Sand:
          return 0xd8ca84;
        case BlockId.Brick:
          return 0xb65448;
        case BlockId.Glass:
          return 0xaed4dc;
        case BlockId.SliverOre:
          return 0x9fa3aa;
        case BlockId.RubyOre:
          return 0xa26464;
        case BlockId.GoldOre:
          return 0xd9b33b;
        case BlockId.SapphireOre:
          return 0x3f92d6;
        case BlockId.DiamondOre:
          return 0x85e9f4;
        default:
          return 0xbababa;
      }
    };

    const updateHeldItem = () => {
      const slot = inventoryRef.current[selectedSlotRef.current];
      const key = slot?.id && slot.count > 0 ? `${slot.id}:${slot.count > 0 ? 1 : 0}` : "";
      if (key === heldKey) return;
      clearHeldItem();
      if (!slot?.id || slot.count <= 0 || !slot.kind) return;

      let mesh: THREE.Object3D;
      if (slot.kind === "block") {
        const geometry = new THREE.BoxGeometry(0.22, 0.22, 0.22);
        const material = new THREE.MeshStandardMaterial({ color: blockColor(slot.blockId), roughness: 0.7, metalness: 0.05 });
        heldGeometries.push(geometry);
        heldMaterials.push(material);
        mesh = new THREE.Mesh(geometry, material);
      } else if (slot.kind === "tool") {
        const group = new THREE.Group();
        const handleGeom = new THREE.BoxGeometry(0.05, 0.28, 0.05);
        const handleMat = new THREE.MeshStandardMaterial({ color: 0x8d653d, roughness: 0.82, metalness: 0.02 });
        const headGeom = new THREE.BoxGeometry(0.18, 0.07, 0.07);
        const headMat = new THREE.MeshStandardMaterial({ color: 0x9da1a8, roughness: 0.58, metalness: 0.1 });
        heldGeometries.push(handleGeom, headGeom);
        heldMaterials.push(handleMat, headMat);
        const handle = new THREE.Mesh(handleGeom, handleMat);
        const head = new THREE.Mesh(headGeom, headMat);
        handle.position.set(0, -0.06, 0);
        head.position.set(0.05, 0.07, 0);
        group.add(handle, head);
        mesh = group;
      } else {
        const geometry = new THREE.BoxGeometry(0.07, 0.34, 0.03);
        const material = new THREE.MeshStandardMaterial({ color: 0xc2c7cc, roughness: 0.5, metalness: 0.18 });
        heldGeometries.push(geometry);
        heldMaterials.push(material);
        mesh = new THREE.Mesh(geometry, material);
      }

      mesh.position.set(0.34, -0.28, -0.55);
      mesh.rotation.set(-0.35, -0.55, -0.12);
      heldRoot.add(mesh);
      heldMesh = mesh;
      heldKey = key;
    };

    const respawn = () => {
      const spawn = randomLandPointNear(world.sizeX / 2, world.sizeZ / 2, RENDER_RADIUS * 0.9);
      player.position.set(spawn.x, spawn.y + 2, spawn.z);
      player.velocity.set(0, 0, 0);
      controls.pitch = 0;
      controls.keys.clear();
      leftMouseHeldRef.current = false;
      mineTargetRef.current = "";
      mineProgressRef.current = 0;
      updateCamera();
      updateHeldItem();
    };

    updateCamera();
    updateHeldItem();

    const applyDamage = createApplyDamage({
      heartsRef,
      isDeadRef,
      respawnTimerRef,
      respawnShownRef,
      setHearts,
      setRespawnSeconds,
      clearControls: () => controls.keys.clear(),
      exitPointerLock: () => {
        if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      }
    });
    const applyDamageWithArmor = (amount: number) => {
      const reduction = armorReductionFromInventory(inventoryRef.current, equippedArmorRef.current);
      const mitigated = Math.max(1, Math.floor(amount * (1 - reduction)));
      applyDamage(mitigated);
    };

    let currentRegionX = Number.NaN;
    let currentRegionZ = Number.NaN;

    const rebuildWorldMesh = (force = false) => {
      const regionX = Math.floor(player.position.x / RENDER_GRID) * RENDER_GRID;
      const regionZ = Math.floor(player.position.z / RENDER_GRID) * RENDER_GRID;
      if (!force && regionX === currentRegionX && regionZ === currentRegionZ) return;

      currentRegionX = regionX;
      currentRegionZ = regionZ;

      const geometry = world.buildGeometryRegion(regionX - RENDER_RADIUS, regionX + RENDER_RADIUS, regionZ - RENDER_RADIUS, regionZ + RENDER_RADIUS);
      scene.remove(worldMesh);
      worldMesh.geometry.dispose();
      worldMesh = new THREE.Mesh(geometry, worldMaterial);
      scene.add(worldMesh);
    };

    rebuildWorldMesh(true);

    const onEmergencyUnstuck = (event: KeyboardEvent) => {
      if (event.code !== "KeyU" || isDeadRef.current) return;
      forceUnstuck(player.position.x, player.position.z);
      updateCamera();
      rebuildWorldMesh(true);
    };
    window.addEventListener("keydown", onEmergencyUnstuck);

    const { persistSave, loadFromSave, resetWorld } = createPersistenceHandlers({
      worldSeed: world.seed,
      changedBlocks,
      inventoryRef,
      equippedArmorRef,
      selectedSlotRef,
      playerPosition: player.position,
      setSaveMessage
    });

    saveNowRef.current = persistSave;
    loadNowRef.current = loadFromSave;
    resetNowRef.current = resetWorld;
    const autoSaveId = window.setInterval(persistSave, 15000);
    const onBeforeUnload = () => persistSave();
    window.addEventListener("beforeunload", onBeforeUnload);

    const setBlockTracked = (x: number, y: number, z: number, nextBlock: BlockId) => {
      if (!world.inBounds(x, y, z)) return;
      const idx = world.index(x, y, z);
      if (!baselineByIndex.has(idx)) baselineByIndex.set(idx, world.get(x, y, z));
      world.set(x, y, z, nextBlock);
      const baseline = baselineByIndex.get(idx) ?? BlockId.Air;
      if (nextBlock === baseline) changedBlocks.delete(idx);
      else changedBlocks.set(idx, nextBlock);
    };

    const addBlockDrop = (block: BlockId) => {
      const slotId = BLOCK_TO_SLOT[block];
      if (slotId) adjustSlotCount(slotId, 1);
    };

    const createMiningContext = () => ({
      world,
      camera,
      pointerLockElement: renderer.domElement,
      pointer,
      raycaster,
      playerPosition: player.position,
      playerHeight: PLAYER_HEIGHT,
      playerHalfWidth: PLAYER_HALF_WIDTH,
      selectedSlotRef,
      inventoryRef,
      mineProgressRef,
      mineTargetRef,
      leftMouseHeldRef,
      inventoryOpenRef,
      isDeadRef,
      adjustSlotCount,
      addBlockDrop,
      setBlockTracked,
      rebuildWorldMesh
    });

    const removeMobAt = (index: number) => {
      const mob = mobs[index];
      scene.remove(mob.group);
      mobs.splice(index, 1);
      if (mob.hostile) adjustSlotCount("cobble", 1);
      else adjustSlotCount("food", 1);
    };

    const placeSelectedBlock = () => doPlace(createMiningContext());

    const eatSelectedFood = () => {
      const slot = inventoryRef.current[selectedSlotRef.current];
      if (!slot?.id || slot.id !== "food" || slot.count <= 0) return;
      adjustSlotCount("food", -1, selectedSlotRef.current);
      const next = Math.min(MAX_ENERGY, energyRef.current + 34);
      energyRef.current = next;
      setEnergy(next);
    };

    const unbindInput = bindGameInput({
      mount,
      camera,
      renderer,
      controls,
      inventoryRef,
      inventoryOpenRef,
      isDeadRef,
      leftMouseHeldRef,
      mineTargetRef,
      mineProgressRef,
      setLocked,
      hotbarSlots: HOTBAR_SLOTS,
      setSelectedSlot,
      setInventoryOpen,
      setCapsActive,
      placeSelectedBlock,
      onEatFood: eatSelectedFood,
      tryAttackAction: () =>
        tryAttackMob(mobs, camera, player.position, weaponDamage(inventoryRef, selectedSlotRef), (idx) => {
          removeMobAt(idx);
          setPassiveCount(mobs.filter((mob) => !mob.hostile).length);
          setHostileCount(mobs.filter((mob) => mob.hostile).length);
        })
    });

    let last = performance.now();
    let dayClock = 0;
    let dayHudTimer = 0;
    let voidTimer = 0;
    let regenTimer = 0;
    let sprintDistanceBudget = 0;
    let walkDistanceBudget = 0;
    let jumpBudget = 0;

    const tickMobsRuntime = (dt: number, time: number) =>
      tickMobs({
        dt,
        time,
        worldSizeX: world.sizeX,
        worldSizeZ: world.sizeZ,
        playerPosition: player.position,
        playerVelocity: player.velocity,
        isDead: isDeadRef.current,
        surfaceYAt,
        mobs,
        applyDamage: applyDamageWithArmor,
        removeMobAt,
        onCountsChanged: () => {
          setPassiveCount(mobs.filter((mob) => !mob.hostile).length);
          setHostileCount(mobs.filter((mob) => mob.hostile).length);
        }
      });

    const clock = () => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      if (
        collidesAt(world, player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT) ||
        player.position.y < 2 ||
        world.get(Math.floor(player.position.x), Math.floor(player.position.y), Math.floor(player.position.z)) === BlockId.Water
      ) {
        forceUnstuck(player.position.x, player.position.z);
      }

      if (
        tickDeathAndRespawn({
          dt,
          maxHearts: MAX_HEARTS,
          heartsRef,
          isDeadRef,
          respawnTimerRef,
          respawnShownRef,
          setHearts,
          setRespawnSeconds,
          onRespawn: respawn,
          onDeadFrame: () => {
            tickMobsRuntime(dt, now);
            rebuildWorldMesh(false);
            updateCamera();
            renderer.render(scene, camera);
          }
        }).skipFrame
      ) {
        animationFrame = requestAnimationFrame(clock);
        return;
      }

      const energyRatio = Math.max(0, Math.min(1, energyRef.current / MAX_ENERGY));
      const speedScale = 0.62 + energyRatio * 0.38 + (energyRatio >= 0.99 ? 0.08 : 0);

      const moveTick = tickPlayerMovement({
        dt,
        world,
        camera,
        keys: controls.keys,
        capsActive: capsActiveRef.current,
        player,
        playerHeight: PLAYER_HEIGHT,
        playerHalfWidth: PLAYER_HALF_WIDTH,
        walkSpeed: WALK_SPEED * speedScale,
        sprintSpeed: SPRINT_SPEED * speedScale,
        crouchSpeed: CROUCH_SPEED,
        gravity: GRAVITY,
        jumpVelocity: JUMP_VELOCITY,
        worldBorderPadding: 1.2,
        voidTimer,
        canSprint: energyRef.current > 0,
        applyDamage: applyDamageWithArmor
      });
      voidTimer = moveTick.voidTimer;

      let drain = 0;
      if (moveTick.didSprint) {
        sprintDistanceBudget += moveTick.horizontalDistance;
        while (sprintDistanceBudget >= 20) {
          sprintDistanceBudget -= 20;
          drain += 1;
        }
      } else if (moveTick.didWalk) {
        walkDistanceBudget += moveTick.horizontalDistance;
        while (walkDistanceBudget >= 60) {
          walkDistanceBudget -= 60;
          drain += 1;
        }
      }
      if (moveTick.didJump) {
        jumpBudget += 1;
        while (jumpBudget >= 10) {
          jumpBudget -= 10;
          drain += 1;
        }
      }
      if (drain > 0) {
        const next = Math.max(0, energyRef.current - drain);
        if (next !== energyRef.current) {
          energyRef.current = next;
          setEnergy(next);
        }
      }

      if (!isDeadRef.current && heartsRef.current < MAX_HEARTS) {
        regenTimer += dt;
        if (regenTimer >= 3) {
          heartsRef.current = Math.min(MAX_HEARTS, heartsRef.current + 1);
          setHearts(heartsRef.current);
          regenTimer = 0;
        }
      } else {
        regenTimer = 0;
      }

      processMining(createMiningContext(), dt);
      updateHeldItem();
      ({ dayClock, dayHudTimer } = tickDayNight({
        dt,
        dayClock,
        dayHudTimer,
        sun,
        hemiLight,
        daySky,
        nightSky,
        liveSky,
        scene,
        setDaylightPercent
      }));

      tickMobsRuntime(dt, now);
      rebuildWorldMesh(false);
      updateCamera();
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(clock);
    };

    let animationFrame = requestAnimationFrame(clock);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.clearInterval(autoSaveId);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("keydown", onEmergencyUnstuck);
      saveNowRef.current = null;
      loadNowRef.current = null;
      unbindInput();
      document.exitPointerLock();

      for (const mob of mobs) scene.remove(mob.group);
      for (const entry of disposables) {
        for (const material of entry.materials) material.dispose();
        for (const geometry of entry.geometries) geometry.dispose();
      }

      scene.remove(worldMesh);
      clearHeldItem();
      camera.remove(heldRoot);
      worldMesh.geometry.dispose();
      worldMaterial.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  const selectedSlotData = inventory[selectedSlot]?.id ? inventory[selectedSlot] : undefined;

  return {
    mountRef,
    locked,
    selectedSlot,
    setSelectedSlot,
    capsActive,
    inventoryOpen,
    inventory,
    equippedArmor,
    hearts,
    energy,
    daylightPercent,
    passiveCount,
    hostileCount,
    respawnSeconds,
    saveMessage,
    heartDisplay,
    selectedSlotData,
    hotbarSlots: HOTBAR_SLOTS,
    recipes: RECIPES,
    maxHearts: MAX_HEARTS,
    maxEnergy: MAX_ENERGY,
    canCraft,
    craft,
    swapInventorySlots,
    toggleEquipArmor,
    saveNow: () => saveNowRef.current?.(),
    loadNow: () => loadNowRef.current?.(),
    resetNow: () => resetNowRef.current?.()
  };
}
