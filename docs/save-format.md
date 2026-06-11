# Save format & compatibility

## Schema

`SaveDataV1` in `lib/game/types.ts`:

- world `seed`
- a block **diff** list — `changes: [blockIndex, blockId][]`; edits that revert to the generated baseline are pruned
- inventory slots with durability
- equipped armor
- selected hotbar slot
- player position

Stored in localStorage under `SAVE_KEY` (`minecraft_save_v4`, defined in `lib/game/config.ts`). Read/write and restore validation live in `lib/game/save.ts` (the `Storage` is injectable for tests); `GameEngine.serialize()` produces the save from live state, and `lib/game/engine/blockChanges.ts` maintains the block diff.

## Autosave

Every 15s via `setInterval`, plus on `beforeunload`.

## Compatibility rules

- Saves store **diffs against generated terrain**, so changing world generation or the voxel index formula (`x + z*sizeX + y*sizeX*sizeZ`) silently corrupts existing saves — bump `SAVE_KEY` when you do.
- Worldgen output is pinned by SHA-256 characterization tests in `lib/world/generation.test.ts`; they fail on any byte-level change. See [testing.md](testing.md) for the re-baseline policy. Caveat: the noise functions use `Math.sin`, whose exact results are engine-defined — the tests prove refactor purity on the pinned Bun version, not cross-browser save portability.
- Changing the save shape requires bumping the `version` field and handling (or discarding) old data. Round-trip tests live in `lib/game/save.test.ts` and `lib/game/engine/GameEngine.test.ts`.
- Note save-format/worldgen impact in PRs.
