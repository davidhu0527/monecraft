# Save format & compatibility

## Schema

`SaveData` (version 4) in `lib/game/types.ts`:

- world `seed`
- a block **diff** list — `changes: [blockIndex, blockId][]`; edits that revert to the generated baseline are pruned (player-placed crops, beds, furnaces, chests, and both halves/states of doors ride this list — they are ordinary block edits)
- inventory slots with durability (36 slots; the first 9 are the hotbar)
- equipped armor
- selected hotbar slot (0–8)
- player position
- `dayClock`, `hearts`, `hunger` (all optional) — time of day and player stats, so sleeping through the night and a hurt/hungry player survive a reload
- `spawnPoint` (optional, `{x,y,z}` or null) — the bed respawn point; respawn falls back to a random land point when it is null or the block there is no longer a bed
- `blockEntities` (optional) — chest contents as `{ index, slots }[]`, keyed by the block's voxel index (the same index space as `changes`). Only **non-empty** chests are stored; an empty one carries no data and is recreated empty when opened. On load each entry is kept only if that index still holds a Chest block. This is the first per-block metadata in the format — `lib/game/save.ts` (`serializeContainers` / `readContainers`) handles it

Stored in localStorage under `SAVE_KEY` (`minecraft_save_v5`, defined in `lib/game/config.ts`). Read/write and restore validation live in `lib/game/save.ts` (the `Storage` is injectable for tests); `GameEngine.serialize()` produces the save from live state, and `lib/game/engine/blockChanges.ts` maintains the block diff.

Audio volume preferences live under a **separate** key (`minecraft_audio_v1`, `lib/game/audio/settings.ts`) and are not part of the world save or its versioning.

Continuous-water exposure and damage cadence live only in transient `GameTimers`.
Saving/reloading or respawning resets the one-minute exposure clock.

### Version history

- **v4** — adds optional `blockEntities` (chest contents). `migrateSaveV3toV4` is a pure version bump (absent → restores as no containers), so **`SAVE_KEY` is unchanged** (chests are never generated; worldgen and the index formula are untouched) and v1/v2/v3 saves load fine. `readSave` chains v1 → v2 → v3 → v4.
- **v3** — adds optional `dayClock`, `hearts`, `hunger`, and `spawnPoint`. `migrateSaveV2toV3` is a pure version bump (the new fields stay absent and restore as engine defaults), so **`SAVE_KEY` is unchanged** and v1/v2 saves load fine.
- **v2** — same fields as v1, reinterpreted for the 36-slot inventory and 9-slot hotbar.
- **v1** — 40 slots, 10-slot hotbar. Still accepted: `readSave` runs `migrateSaveV1toV2`, which packs non-empty slots in order, merges stackable items into earlier stacks, clamps `selectedSlot` to 0–8, and drops items that overflow the smaller inventory.
- Unknown future versions are rejected (treated as no save).

## Autosave

Every 15s via `setInterval`, plus on `beforeunload`.

## Compatibility rules

- Saves store **diffs against generated terrain**, so changing world generation or the voxel index formula (`x + z*sizeX + y*sizeX*sizeZ`) silently corrupts existing saves — bump `SAVE_KEY` when you do.
- Worldgen output is pinned by SHA-256 characterization tests in `lib/world/generation.test.ts`; they fail on any byte-level change. See [testing.md](testing.md) for the re-baseline policy. Caveat: the noise functions use `Math.sin`, whose exact results are engine-defined — the tests prove refactor purity on the pinned Bun version, not cross-browser save portability.
- Changing the save shape requires bumping the `version` field and handling (or discarding) old data. Round-trip tests live in `lib/game/save.test.ts` and `lib/game/engine/GameEngine.test.ts`.
- Note save-format/worldgen impact in PRs.
