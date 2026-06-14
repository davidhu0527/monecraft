# Save format & compatibility

## Schema

`SaveData` (version 5) in `lib/game/types.ts`:

- world `seed`
- a block **diff** list — `changes: [blockIndex, blockId][]`; edits that revert to the generated baseline are pruned (player-placed crops, beds, furnaces, chests, and both halves/states of doors ride this list — they are ordinary block edits)
- inventory slots with durability (36 slots; the first 9 are the hotbar)
- equipped armor
- selected hotbar slot (0–8)
- player position
- `dayClock`, `hearts`, `hunger` (all optional) — time of day and player stats, so sleeping through the night and a hurt/hungry player survive a reload
- `spawnPoint` (optional, `{x,y,z}` or null) — the bed respawn point; respawn falls back to a random land point when it is null or the block there is no longer a bed
- `blockEntities` (optional) — chest contents as `{ index, slots }[]`, keyed by the block's voxel index (the same index space as `changes`). Only **non-empty** chests are stored; an empty one carries no data and is recreated empty when opened. On load each entry is kept only if that index still holds a Chest block. This is the first per-block metadata in the format — `lib/game/save.ts` (`serializeContainers` / `readContainers`) handles it
- `lootedChests` (optional) — voxel indices of dungeon loot chests the player has already opened or broken. Dungeon chests are placed by worldgen, so their contents are **not** in `changes`/`blockEntities` until accessed; the engine fills them lazily on first access (loot seeded from `world.seed ^ index`) and records the index here. Because an emptied chest drops out of `blockEntities`, this set — not the chest's emptiness — is what prevents a re-roll on reload. The session-only set of _which_ indices are dungeon chests/spawners is not stored; it is re-derived from the seed each load via `collectDungeonSites` (`lib/world/generation.ts`). Handled by `serializeLootedChests` / `readLootedChests` in `lib/game/save.ts`

Each world's `SaveData` is stored in its own localStorage key, `minecraft_world_save_<worldId>` (`worldSaveKey` in `lib/game/worlds.ts`). Read/write and restore validation live in `lib/game/save.ts` — `readSave`/`writeSave` take the key as a parameter and the `Storage` is injectable for tests; `GameEngine.serialize()` produces the save from live state, and `lib/game/engine/blockChanges.ts` maintains the block diff. (The legacy single-world key `SAVE_KEY` = `minecraft_save_v7` is now read only once, by the migration described under [Profiles & worlds](#profiles--worlds).)

Audio volume preferences live under a **separate**, global key (`minecraft_audio_v1`, `lib/game/audio/settings.ts`), shared across all profiles and not part of any world save or its versioning.

**Per-voxel light is never serialized.** It is a derived cache (`world.light`), recomputed from the blocks at load by `computeFullLight` and patched locally on every edit (`lib/world/lighting.ts`); the bake reads only `world.blocks`, so the save needs no lighting field.

Continuous-water exposure, lava burn, and the oxygen/drowning meter all live only
in transient `GameTimers`/state. Saving, reloading, or respawning resets them
(breath restores to full).

### Version history

- **v5** (unchanged for caves & lighting) — the lighting system adds no persisted state (light is a derived cache, recomputed at load), and lava is worldgen, not a saved field. So the save _schema_ stays at version 5. But the deep-cave lava changes the deterministic terrain baseline, so **`SAVE_KEY` is bumped `minecraft_save_v6` → `minecraft_save_v7`**: old block-diffs were computed against the lava-free world and must never be applied to the new one. Pre-lava saves are discarded in practice. Torches are additive items/blocks, persisted by string id / in the block diff like any other placed block.
- **v5** (unchanged for ranged combat & the endgame boss) — bows, arrows, the Cursed Totem, the Dragon Heart, and the Dragon Sword are **additive items**, persisted by string id in the existing inventory/container slots, so no schema change was needed. **Arrows in flight, the boss, its minions, and the `victory` flag are all transient** (never serialized — like mobs), and there is no worldgen change (the boss is summoned, not generated), so neither the `version` nor `SAVE_KEY` moved.
- **v5** — adds optional `lootedChests` (opened/broken dungeon loot chests). `migrateSaveV4toV5` is a pure version bump (absent → no dungeon chests yet looted). Unlike v3/v4, **`SAVE_KEY` is bumped to `minecraft_save_v6`** here — not because of the save _shape_ (the field is additive) but because the dungeon worldgen changed the deterministic terrain baseline, so old block-diffs would index against the wrong world. Pre-dungeon saves are therefore discarded in practice; the migration keeps the version chain complete regardless. `readSave` chains v1 → v2 → v3 → v4 → v5.
- **v4** — adds optional `blockEntities` (chest contents). `migrateSaveV3toV4` is a pure version bump (absent → restores as no containers), so **`SAVE_KEY` was unchanged** at the time (player-placed chests only; worldgen and the index formula were untouched) and v1/v2/v3 saves load fine.
- **v3** — adds optional `dayClock`, `hearts`, `hunger`, and `spawnPoint`. `migrateSaveV2toV3` is a pure version bump (the new fields stay absent and restore as engine defaults), so **`SAVE_KEY` is unchanged** and v1/v2 saves load fine.
- **v2** — same fields as v1, reinterpreted for the 36-slot inventory and 9-slot hotbar.
- **v1** — 40 slots, 10-slot hotbar. Still accepted: `readSave` runs `migrateSaveV1toV2`, which packs non-empty slots in order, merges stackable items into earlier stacks, clamps `selectedSlot` to 0–8, and drops items that overflow the smaller inventory.
- Unknown future versions are rejected (treated as no save).

## Profiles & worlds

Saves are organized two levels deep — a **profile** owns a list of **worlds**, and each world holds one `SaveData` blob — across three localStorage keys. All three are versioned `{ version: 1, ... }` envelopes and their readers are **total** (malformed entries are dropped, never thrown):

- **`minecraft_profiles_v1`** (`lib/game/profiles.ts`) — the profile list plus `activeProfileId`. A profile is `{ id, name, skinId, createdAt }`: player identity only (name + skin). The skin moved here from the old global `minecraft_skin_v1` key; a dangling `activeProfileId` is repaired on read.
- **`minecraft_worlds_v1`** (`lib/game/worlds.ts`) — the world index. Each `WorldMeta` is `{ id, profileId, name, seed, worldgenVersion, createdAt, lastPlayedAt }`; `profileId` is the 1:N owner link and `lastPlayedAt` drives the most-recent-first ordering. The `seed` is resolved once at creation (blank → random, numeric text → clamped int, other text → stable FNV hash via `resolveSeed`) and is the source of truth for regeneration.
- **`minecraft_world_save_<worldId>`** — one `SaveData` blob per world (the schema above), read/written through `readSave`/`writeSave`.

`worldgenVersion` records the `WORLDGEN_VERSION` (`lib/game/config.ts`, currently 7) the world was generated under. This **replaces the old whole-store `SAVE_KEY` bump**: when the worldgen baseline changes, bump `WORLDGEN_VERSION`, and a world whose recorded version differs has its stale block-diffs discarded and reboots from its stored seed — per-world, with no key rename and without touching unaffected worlds.

The game shell (`components/GameShell.tsx`) drives a profile-select → world-select → play state machine and remembers the tab's active world in `sessionStorage` so a reload resumes it (a fresh tab cold-starts at profile-select). Deleting a profile cascades its worlds and their save blobs (`deleteWorldsForProfile`).

### Legacy migration

`migrateLegacySave` (`lib/game/legacyMigration.ts`) runs once on first boot, gated on the **absence** of `minecraft_profiles_v1` (its presence is the already-migrated flag, which survives a rollback that re-creates the legacy key). When a legacy `minecraft_save_v7` exists it creates a default "Player" profile (carrying the old global skin) and **copies** the save into one "My World" blob, then removes the legacy key — the copy precedes the delete so a mid-migration failure can never lose the original. A brand-new player with **no** legacy save gets nothing here; the menu opens straight into the create-profile form (`ProfileSelect` renders it whenever there are zero profiles), so their first act is naming and skinning a profile.

## Autosave

Every 15s via `setInterval`, plus on `beforeunload`, all writing to the active world's `minecraft_world_save_<id>` key. "Save & Quit to Worlds" also persists synchronously before leaving, because the interval is cleared on unmount and `beforeunload` does not fire on an in-app world switch.

## Compatibility rules

- Saves store **diffs against generated terrain**, so changing world generation or the voxel index formula (`x + z*sizeX + y*sizeX*sizeZ`) silently corrupts existing saves — bump `WORLDGEN_VERSION` when you do, and each world discards its stale diffs (rebooting from its seed) on the mismatch.
- Worldgen output is pinned by SHA-256 characterization tests in `lib/world/generation.test.ts`; they fail on any byte-level change. See [testing.md](testing.md) for the re-baseline policy. Caveat: the noise functions use `Math.sin`, whose exact results are engine-defined — the tests prove refactor purity on the pinned Bun version, not cross-browser save portability.
- Changing the save shape requires bumping the `version` field and handling (or discarding) old data. Round-trip tests live in `lib/game/save.test.ts` and `lib/game/engine/GameEngine.test.ts`.
- Durable gear restores at a maximum count of one per slot. The v1→v2 migration
  splits legacy stacked gear into separate slots until inventory capacity is
  exhausted; current malformed stacks are clamped to one.
- Note save-format/worldgen impact in PRs.
