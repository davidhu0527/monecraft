/**
 * One-time migration from the single-world era into the profile/world model.
 *
 * Before this feature the game kept one world under `minecraft_save_v7` and a
 * global skin under `minecraft_skin_v1`. On first boot after the feature lands,
 * we fold those into a default "Player" profile (carrying the old skin) plus a
 * single "My World" pointing at a copy of the old save blob.
 *
 * Idempotent and gated on the *profiles manifest's absence* — its presence is
 * the "already migrated" flag, so this survives a rollback that re-creates the
 * legacy key. Storage and the createdAt/id sources are injectable for tests.
 */

import { SAVE_KEY } from "./config";
import { resolveDeps, type ManifestDeps } from "./manifest";
import { createProfile, PROFILES_KEY } from "./profiles";
import { readSave, writeSave } from "./save";
import { readSkinSettings } from "./skinSettings";
import { createWorld, worldSaveKey } from "./worlds";

export const LEGACY_WORLD_NAME = "My World";

export function migrateLegacySave(deps: ManifestDeps = {}): void {
  const { storage } = resolveDeps(deps);

  // Presence of the profiles manifest means the feature has already run here.
  if (storage.getItem(PROFILES_KEY) !== null) return;

  const legacy = readSave(SAVE_KEY, storage); // runs the v1->v5 migration chain

  // Brand-new player (no legacy save): create nothing. The menu greets them with
  // the create-profile form so their first act is naming + skinning a profile.
  if (!legacy) return;

  const { skinId } = readSkinSettings(storage); // old global skin seeds the default profile
  const profile = createProfile("Player", skinId, deps); // writes the manifest, becomes active
  const world = createWorld(profile.id, LEGACY_WORLD_NAME, String(legacy.seed), deps);
  try {
    // Copy (not move) so a mid-migration failure can never lose the original.
    writeSave(worldSaveKey(world.id), legacy, storage);
    try {
      storage.removeItem(SAVE_KEY);
    } catch {
      // Leaving the legacy key just wastes a little space; the copy is authoritative.
    }
  } catch {
    // Quota failure copying the blob (storage briefly holds both): the world
    // record still exists and will boot fresh from its stored seed; the legacy
    // key is left intact rather than risk losing the original edits.
  }
}
