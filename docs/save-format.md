# Save format & compatibility

## Schema

`SaveDataV1` in `lib/game/types.ts`:

- world `seed`
- a block **diff** list — `changes: [blockIndex, blockId][]`; edits that revert to the generated baseline are pruned
- inventory slots with durability
- equipped armor
- selected hotbar slot
- player position

Stored in localStorage under `SAVE_KEY` (`minecraft_save_v4`, defined in `lib/game/config.ts`). Read/write via `readSave`/`writeSave` in `lib/game/save.ts`; orchestration in `lib/game/runtime/persistence.ts`.

## Autosave

Every 15s via `setInterval`, plus on `beforeunload`.

## Compatibility rules

- Saves store **diffs against generated terrain**, so changing world generation or the voxel index formula (`x + z*sizeX + y*sizeX*sizeZ`) silently corrupts existing saves — bump `SAVE_KEY` when you do.
- Changing the save shape requires bumping the `version` field and handling (or discarding) old data.
- Note save-format/worldgen impact in PRs.
