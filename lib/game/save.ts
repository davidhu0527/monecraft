import { CHEST_SLOTS, CUSTOM_NAME_MAX_LEN, HOTBAR_SLOTS, INVENTORY_SLOTS, MAX_HEARTS, MAX_HUNGER, MAX_STACK_SIZE } from "@/lib/game/config";
import { ENCHANTMENT_DEFS } from "@/lib/game/enchantments";
import { ARMOR_SLOTS, createEmptyArmorEquipment, createEmptySlot, createSlot, ITEM_DEF_BY_ID, maxStackSizeForItem } from "@/lib/game/items";
import type {
  EffectId,
  Enchantment,
  EnchantmentId,
  EquippedArmor,
  SaveData,
  SaveDataV1,
  SaveDataV2,
  SaveDataV3,
  SaveDataV4,
  SaveDataV5,
  SaveDataV6,
  SaveDataV7,
  SaveDataV8,
  SaveDataV9,
  SaveDataV10,
  SaveDataV11,
  SavedContainer,
  SavedEffect,
  SavedEquippedArmor,
  SavedSlot,
  InventorySlot
} from "@/lib/game/types";
import { isGameMode, type GameMode } from "@/lib/game/gameModes";
import { isDifficulty, type Difficulty } from "@/lib/game/difficulties";

/**
 * Migrates a v1 save (40 slots, 10-slot hotbar) to v2 (36 slots, 9-slot
 * hotbar): non-empty slots are packed in order, stackable items merge into
 * earlier stacks, and anything that still overflows 36 slots is dropped.
 */
/** Coerces a persisted hotbar index to a finite integer within 0..HOTBAR_SLOTS-1. */
function normalizeSelectedSlot(value: number): number {
  const index = Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.max(0, Math.min(HOTBAR_SLOTS - 1, index));
}

export function migrateSaveV1toV2(save: SaveDataV1): SaveDataV2 {
  const migrated: SaveDataV2 = { ...save, version: 2, selectedSlot: normalizeSelectedSlot(save.selectedSlot) };

  if (Array.isArray(save.inventorySlots)) {
    const packed: Array<{ id: string | null; count: number; durability?: number }> = [];
    for (const saved of save.inventorySlots) {
      if (!saved?.id || saved.count <= 0) continue;
      // Items without durability stack; merge them into an earlier stack first.
      const stackable = ITEM_DEF_BY_ID[saved.id] ? !ITEM_DEF_BY_ID[saved.id].maxDurability : false;
      let remaining = saved.count;
      if (stackable) {
        for (const slot of packed) {
          if (slot.id !== saved.id || slot.count >= MAX_STACK_SIZE) continue;
          const moved = Math.min(MAX_STACK_SIZE - slot.count, remaining);
          slot.count += moved;
          remaining -= moved;
          if (remaining === 0) break;
        }
      }
      while (remaining > 0 && packed.length < INVENTORY_SLOTS) {
        const moved = Math.min(maxStackSizeForItem(saved.id), remaining);
        packed.push({ id: saved.id, count: moved, durability: saved.durability });
        remaining -= moved;
      }
    }
    migrated.inventorySlots = packed;
  }

  return migrated;
}

/**
 * Migrates a v2 save to v3 — a pure version bump. The new persisted fields
 * (dayClock, hearts, hunger, spawnPoint) are optional, so an older save simply
 * loads with the engine's defaults for them.
 */
export function migrateSaveV2toV3(save: SaveDataV2): SaveDataV3 {
  return { ...save, version: 3 };
}

/**
 * Migrates a v3 save to v4 — a pure version bump. `blockEntities` (chest
 * contents) is optional, so a pre-chest save simply loads with no containers.
 */
export function migrateSaveV3toV4(save: SaveDataV3): SaveDataV4 {
  return { ...save, version: 4 };
}

/**
 * Migrates a v4 save to v5 — a pure version bump. `lootedChests` is optional,
 * so a pre-dungeon save simply loads with no dungeon chests yet looted. (In
 * practice the SAVE_KEY bump to v6 discards pre-dungeon saves, but the
 * migration keeps the version chain complete and the readers total.)
 */
export function migrateSaveV4toV5(save: SaveDataV4): SaveDataV5 {
  return { ...save, version: 5 };
}

/**
 * Migrates a v5 save to v6 — a pure version bump. `effects` (active status
 * effects) is optional, so a pre-effect save simply loads with none active.
 */
export function migrateSaveV5toV6(save: SaveDataV5): SaveDataV6 {
  return { ...save, version: 6 };
}

/**
 * Migrates a v6 save to v7 — a pure version bump. `xp` (and per-slot
 * `enchantments`) are optional, so a pre-XP save simply loads with `xp` 0 and no
 * enchantments.
 */
export function migrateSaveV6toV7(save: SaveDataV6): SaveDataV7 {
  return { ...save, version: 7 };
}

/**
 * Migrates a v7 save to v8 — a pure version bump. `gameMode` is optional, so a
 * pre-mode save simply loads as "survival" (see restoreGameMode).
 */
export function migrateSaveV7toV8(save: SaveDataV7): SaveDataV8 {
  return { ...save, version: 8 };
}

/**
 * Migrates a v8 save to v9 — a pure version bump. `difficulty` is optional, so a
 * pre-difficulty save simply loads as "normal" (see restoreDifficulty).
 */
export function migrateSaveV8toV9(save: SaveDataV8): SaveDataV9 {
  return { ...save, version: 9 };
}

/**
 * Migrates a v9 save to v10 — a pure version bump. `hardcore`/`gameOver` are
 * optional, so a pre-Hardcore save simply loads as a normal, non-hardcore world
 * (see restoreHardcore/restoreGameOver).
 */
export function migrateSaveV9toV10(save: SaveDataV9): SaveDataV10 {
  return { ...save, version: 10 };
}

/**
 * Migrates a v10 save to v11. v11 adds an optional per-item `customName` (the
 * anvil rename) inside each `SavedSlot`; the Mending enchantment rides the
 * existing per-slot `enchantments`. Both are additive, so this is a pure version
 * bump and pre-v11 saves load with no custom names.
 */
export function migrateSaveV10toV11(save: SaveDataV10): SaveDataV11 {
  return { ...save, version: 11 };
}

/**
 * Migrates a v11 save to v12 — armor moves to dedicated storage. The legacy
 * `equippedArmor` was a by-id reference into `inventorySlots` (the worn item also
 * lived in the inventory). For each valid equip, move the matching inventory item
 * out into the armor record (preserving durability/enchantments/customName); drop
 * equips whose item isn't found or isn't valid armor for the slot. Pre-`inventorySlots`
 * (legacy counts-only) saves simply drop the equip map and keep items in inventory.
 */
export function migrateSaveV11toV12(save: SaveDataV11): SaveData {
  const legacy = save.equippedArmor;
  if (!legacy || !Array.isArray(save.inventorySlots)) {
    return { ...save, version: 12, equippedArmor: undefined };
  }
  const slots = save.inventorySlots.slice();
  const equipped: SavedEquippedArmor = {};
  for (const armorSlot of ARMOR_SLOTS) {
    const id = legacy[armorSlot];
    if (!id) continue;
    const def = ITEM_DEF_BY_ID[id];
    if (def?.kind !== "armor" || def.armorSlot !== armorSlot) continue; // drop invalid equips
    const idx = slots.findIndex((s) => s?.id === id && s.count > 0);
    if (idx < 0) continue; // item not in inventory → drop the equip
    equipped[armorSlot] = slots[idx]; // preserves durability/enchantments/customName
    slots[idx] = { id: null, count: 0 };
  }
  return { ...save, version: 12, inventorySlots: slots, equippedArmor: equipped };
}

// Storage is injectable so save logic can be tested without a browser.
export function readSave(saveKey: string, storage: Storage = localStorage): SaveData | null {
  try {
    const raw = storage.getItem(saveKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as
      | SaveData
      | SaveDataV11
      | SaveDataV10
      | SaveDataV9
      | SaveDataV8
      | SaveDataV7
      | SaveDataV6
      | SaveDataV5
      | SaveDataV4
      | SaveDataV3
      | SaveDataV2
      | SaveDataV1;
    if (!parsed || !Number.isFinite(parsed.seed) || !Array.isArray(parsed.changes)) return null;
    let migrated: SaveDataV2 | SaveDataV3 | SaveDataV4 | SaveDataV5 | SaveDataV6 | SaveDataV7 | SaveDataV8 | SaveDataV9 | SaveDataV10 | SaveDataV11 | SaveData =
      parsed.version === 1 ? migrateSaveV1toV2(parsed) : parsed;
    if (migrated.version === 2) migrated = migrateSaveV2toV3(migrated);
    if (migrated.version === 3) migrated = migrateSaveV3toV4(migrated);
    if (migrated.version === 4) migrated = migrateSaveV4toV5(migrated);
    if (migrated.version === 5) migrated = migrateSaveV5toV6(migrated);
    if (migrated.version === 6) migrated = migrateSaveV6toV7(migrated);
    if (migrated.version === 7) migrated = migrateSaveV7toV8(migrated);
    if (migrated.version === 8) migrated = migrateSaveV8toV9(migrated);
    if (migrated.version === 9) migrated = migrateSaveV9toV10(migrated);
    if (migrated.version === 10) migrated = migrateSaveV10toV11(migrated);
    if (migrated.version === 11) migrated = migrateSaveV11toV12(migrated);
    if (migrated.version !== 12) return null;
    return migrated;
  } catch {
    return null;
  }
}

export function writeSave(saveKey: string, data: SaveData, storage: Storage = localStorage): void {
  storage.setItem(saveKey, JSON.stringify(data));
}

export function inventorySlotsSnapshot(inventory: InventorySlot[]): SavedSlot[] {
  return inventory.map((slot) => ({
    id: slot.id,
    count: slot.count,
    durability: slot.durability,
    enchantments: slot.enchantments,
    customName: slot.customName
  }));
}

/** Snapshots the worn armor pieces for persistence (sparse — empty slots are omitted). */
export function serializeEquippedArmor(equipped: EquippedArmor): SavedEquippedArmor {
  const out: SavedEquippedArmor = {};
  for (const armorSlot of ARMOR_SLOTS) {
    const piece = equipped[armorSlot];
    if (!piece?.id || piece.count <= 0) continue;
    out[armorSlot] = { id: piece.id, count: piece.count, durability: piece.durability, enchantments: piece.enchantments, customName: piece.customName };
  }
  return out;
}

// Every known enchantment id, keyed so a new enchantment can't be forgotten here.
const VALID_ENCHANT_IDS: Record<EnchantmentId, true> = {
  sharpness: true,
  protection: true,
  efficiency: true,
  unbreaking: true,
  mending: true,
  power: true,
  punch: true,
  knockback: true,
  looting: true
};

/** Validates persisted enchantments: known ids and integer levels clamped to 1..(that enchant's max); undefined when none survive. */
function restoreEnchantments(saved: SavedSlot["enchantments"]): Enchantment[] | undefined {
  if (!Array.isArray(saved)) return undefined;
  const out: Enchantment[] = [];
  for (const entry of saved) {
    if (!entry || typeof entry.id !== "string" || !Object.hasOwn(VALID_ENCHANT_IDS, entry.id)) continue;
    if (!Number.isFinite(entry.level) || Math.floor(entry.level) < 1) continue;
    // Clamp to the enchantment's own cap so e.g. a tampered mending:3 loads as 1.
    out.push({ id: entry.id, level: Math.min(ENCHANTMENT_DEFS[entry.id].maxLevel, Math.floor(entry.level)) });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Rebuilds one slot from its saved snapshot: drops unknown ids, clamps the
 * count, and clamps/defaults durability for gear (a non-positive saved
 * durability means the piece broke and is dropped). Returns an empty slot for
 * anything invalid. Shared by inventory and container restore.
 */
function restoreSlot(saved: SavedSlot | undefined): InventorySlot {
  if (!saved?.id || saved.count <= 0 || !ITEM_DEF_BY_ID[saved.id]) return createEmptySlot();
  const slot = createSlot(saved.id, Math.min(maxStackSizeForItem(saved.id), Math.max(0, Math.floor(saved.count))));
  if ((slot.kind === "tool" || slot.kind === "weapon" || slot.kind === "armor") && slot.maxDurability) {
    if (typeof saved.durability === "number") {
      const loaded = Math.floor(saved.durability);
      if (loaded <= 0) return createEmptySlot();
      slot.durability = Math.max(1, Math.min(slot.maxDurability, loaded));
    } else {
      slot.durability = slot.maxDurability;
    }
    // Enchantments live only on durable gear; validated against the known set.
    const enchantments = restoreEnchantments(saved.enchantments);
    if (enchantments) slot.enchantments = enchantments;
    // A custom name (anvil rename) also lives only on durable gear; trim and cap it.
    if (typeof saved.customName === "string") {
      const name = saved.customName.trim().slice(0, CUSTOM_NAME_MAX_LEN);
      if (name) slot.customName = name;
    }
  }
  return slot;
}

/** Snapshots non-empty chest containers for persistence (empty chests carry no data). */
export function serializeContainers(containers: Map<number, InventorySlot[]>): SavedContainer[] {
  const out: SavedContainer[] = [];
  for (const [index, slots] of containers) {
    if (!slots.some((slot) => slot.id && slot.count > 0)) continue;
    out.push({ index, slots: inventorySlotsSnapshot(slots) });
  }
  return out;
}

/** Snapshots the set of opened/broken dungeon chest voxel indices for persistence. */
export function serializeLootedChests(looted: Set<number>): number[] {
  return [...looted];
}

/** Reads the opened/broken dungeon chest indices from a save (finite numbers only). */
export function readLootedChests(save: SaveData): number[] {
  if (!Array.isArray(save.lootedChests)) return [];
  return save.lootedChests.filter((value) => Number.isFinite(value));
}

// Every known status-effect id, as a Record keyed by EffectId so adding an
// effect without listing it here is a compile error (keeps the reader total).
const VALID_EFFECT_IDS: Record<EffectId, true> = {
  speed: true,
  strength: true,
  regeneration: true,
  fire_resistance: true,
  water_breathing: true,
  poison: true
};

/** Snapshots the active status effects (id + remaining seconds) for persistence. */
export function serializeEffects(effects: Map<EffectId, number>): SavedEffect[] {
  const out: SavedEffect[] = [];
  for (const [id, remaining] of effects) {
    if (remaining > 0) out.push({ id, remaining });
  }
  return out;
}

/** Reads active effects from a save, dropping unknown ids and non-positive/garbage durations. */
export function restoreEffects(save: SaveData): SavedEffect[] {
  if (!Array.isArray(save.effects)) return [];
  const out: SavedEffect[] = [];
  for (const entry of save.effects) {
    if (!entry || typeof entry.id !== "string" || !Object.hasOwn(VALID_EFFECT_IDS, entry.id)) continue;
    if (!Number.isFinite(entry.remaining) || entry.remaining <= 0) continue;
    out.push({ id: entry.id, remaining: entry.remaining });
  }
  return out;
}

/**
 * Reads chest containers from a save into validated, CHEST_SLOTS-length slot
 * arrays keyed by voxel index. Per-slot validation only — the engine still
 * confirms each index actually holds a Chest block before using it.
 */
export function readContainers(save: SaveData): Array<{ index: number; slots: InventorySlot[] }> {
  if (!Array.isArray(save.blockEntities)) return [];
  const out: Array<{ index: number; slots: InventorySlot[] }> = [];
  for (const entry of save.blockEntities) {
    if (!entry || !Number.isFinite(entry.index) || !Array.isArray(entry.slots)) continue;
    const slots = Array.from({ length: CHEST_SLOTS }, (_, i) => restoreSlot(entry.slots[i]));
    out.push({ index: entry.index, slots });
  }
  return out;
}

/**
 * Rebuilds inventory slots from a save, dropping unknown items, clamping
 * counts and durability, and skipping broken gear. Supports both the current
 * inventorySlots shape and the legacy inventoryCounts shape. Returns null when
 * the save carries no inventory.
 */
export function restoreInventorySlots(save: SaveData): InventorySlot[] | null {
  if (Array.isArray(save.inventorySlots)) {
    const slots = Array.from({ length: INVENTORY_SLOTS }, () => createEmptySlot());
    for (let i = 0; i < Math.min(INVENTORY_SLOTS, save.inventorySlots.length); i += 1) {
      slots[i] = restoreSlot(save.inventorySlots[i]);
    }
    return slots;
  }

  if (save.inventoryCounts) {
    const slots = Array.from({ length: INVENTORY_SLOTS }, () => createEmptySlot());
    let cursor = 0;
    for (const [id, raw] of Object.entries(save.inventoryCounts)) {
      if (!ITEM_DEF_BY_ID[id]) continue;
      let remaining = Math.max(0, Math.floor(raw));
      while (remaining > 0 && cursor < slots.length) {
        const add = Math.min(maxStackSizeForItem(id), remaining);
        slots[cursor] = createSlot(id, add);
        cursor += 1;
        remaining -= add;
      }
    }
    return slots;
  }

  return null;
}

/** Restores worn armor, rebuilding each piece through restoreSlot and dropping anything that isn't valid armor for its slot. */
export function restoreEquippedArmor(save: SaveData): EquippedArmor | null {
  if (!save.equippedArmor) return null;
  const next = createEmptyArmorEquipment();
  for (const armorSlot of ARMOR_SLOTS) {
    const saved = save.equippedArmor[armorSlot];
    if (!saved) continue;
    const slot = restoreSlot(saved);
    if (slot.kind !== "armor" || slot.armorSlot !== armorSlot || slot.count <= 0) continue;
    next[armorSlot] = slot;
  }
  return next;
}

export function restoreSelectedSlot(save: SaveData): number | null {
  if (typeof save.selectedSlot !== "number") return null;
  return normalizeSelectedSlot(save.selectedSlot);
}

/** Restores the day clock from a save (finite, non-negative); null if absent/invalid. */
export function restoreDayClock(save: SaveData): number | null {
  if (typeof save.dayClock !== "number" || !Number.isFinite(save.dayClock) || save.dayClock < 0) return null;
  return save.dayClock;
}

/** Restores hearts clamped to 1..MAX_HEARTS; null if absent/invalid. */
export function restoreHearts(save: SaveData): number | null {
  if (typeof save.hearts !== "number" || !Number.isFinite(save.hearts)) return null;
  return Math.max(1, Math.min(MAX_HEARTS, Math.floor(save.hearts)));
}

/** Restores hunger clamped to 0..MAX_HUNGER; null if absent/invalid. */
export function restoreHungerLevel(save: SaveData): number | null {
  if (typeof save.hunger !== "number" || !Number.isFinite(save.hunger)) return null;
  return Math.max(0, Math.min(MAX_HUNGER, Math.floor(save.hunger)));
}

/** Restores banked XP (finite, ≥ 0); 0 when absent or invalid. */
export function restoreXp(save: SaveData): number {
  if (typeof save.xp !== "number" || !Number.isFinite(save.xp) || save.xp < 0) return 0;
  return Math.floor(save.xp);
}

/** Restores the saved game mode; "survival" when absent or invalid (pre-v8 saves). */
export function restoreGameMode(save: SaveData): GameMode {
  return isGameMode(save.gameMode) ? save.gameMode : "survival";
}

/** Restores the saved difficulty; "normal" when absent or invalid (pre-v9 saves). */
export function restoreDifficulty(save: SaveData): Difficulty {
  return isDifficulty(save.difficulty) ? save.difficulty : "normal";
}

/** Restores the Hardcore flag; false when absent or non-boolean (pre-v10 saves). */
export function restoreHardcore(save: SaveData): boolean {
  return save.hardcore === true;
}

/** Restores the permadeath game-over flag — only ever true on a hardcore save, so a stray flag on a non-hardcore (corrupt) save can't lock it into spectator. */
export function restoreGameOver(save: SaveData): boolean {
  return save.hardcore === true && save.gameOver === true;
}

/** Restores the bed respawn point; null if absent or explicitly cleared. */
export function restoreSpawnPoint(save: SaveData): { x: number; y: number; z: number } | null {
  const sp = save.spawnPoint;
  if (!sp || !Number.isFinite(sp.x) || !Number.isFinite(sp.y) || !Number.isFinite(sp.z)) return null;
  return { x: Math.floor(sp.x), y: Math.floor(sp.y), z: Math.floor(sp.z) };
}

/**
 * Restores the player's position; null when absent or non-finite. A corrupt save
 * with NaN/Infinity coords would otherwise load a broken world — and slip past the
 * `position.y < 2` unstuck net, since any comparison with NaN is false. Coords stay
 * floats (the player isn't grid-aligned), unlike the floored spawn point.
 */
export function restorePlayerPosition(save: SaveData): { x: number; y: number; z: number } | null {
  const p = save.player;
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return null;
  return { x: p.x, y: p.y, z: p.z };
}
