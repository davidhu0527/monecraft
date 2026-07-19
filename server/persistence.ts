import { eq } from "drizzle-orm";
import { db as liveDb, schema, type Db } from "@/db";
import { readSave } from "@/lib/game/save";
import type { SaveData } from "@/lib/game/types";

/**
 * Room persistence: where a world's row and gzipped v17 save blob live.
 * Postgres (the same tables the web API writes) in production; the in-memory
 * adapter backs tests and PERSISTENCE=memory mode (DB-less local iteration
 * and the Playwright multiplayer spec — unknown world ids are auto-created
 * with a seed derived from the id).
 */

export type WorldRecord = {
  id: string;
  seed: number;
  worldType: string;
  difficulty: string;
  hardcore: boolean;
  save: SaveData | null;
};

export type Persistence = {
  loadWorld(worldId: string): Promise<WorldRecord | null>;
  storeWorld(worldId: string, blob: Uint8Array, saveVersion: number): Promise<void>;
};

/**
 * Hard ceiling on a decompressed save. Gzip ratios run ~1000:1 on hostile
 * input, so an unbounded inflate turns a few MiB of stored bytes into GiB of
 * heap on a 512 MB VM. Generous next to any real world (a save is a block diff,
 * not a voxel dump) but bounded, so a malformed or crafted row fails this room
 * rather than the process.
 */
export const MAX_DECOMPRESSED_SAVE_BYTES = 96 * 1024 * 1024;

/**
 * Inflates gzip with a running output cap, cancelling the stream the moment it
 * exceeds `maxBytes` — so the cap bounds what is ALLOCATED, not merely what is
 * returned (which is what checking `.byteLength` after a `gunzipSync` would do).
 */
async function gunzipBounded(blob: Uint8Array, maxBytes: number): Promise<string | null> {
  const reader = new Blob([blob as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/**
 * Parses a stored gzipped SaveData blob through the full readSave
 * validation/migration chain, bounded by MAX_DECOMPRESSED_SAVE_BYTES.
 *
 * Since save PUT is `sp-cloud`-only (lib/online/worldsService.ts) a room should
 * only ever read blobs the server itself wrote, so the bound is depth rather
 * than a live vector — but this is the seam where stored bytes become engine
 * state, and it should not trust the row on the far side of it.
 */
export async function parseSaveBlob(blob: Uint8Array, maxBytes = MAX_DECOMPRESSED_SAVE_BYTES): Promise<SaveData | null> {
  try {
    // readSave via a one-key Storage shim, so the entire migration + validation
    // pipeline applies to server-loaded saves too.
    const json = await gunzipBounded(blob, maxBytes);
    if (json === null) return null;
    const shim = { getItem: () => json } as unknown as Storage;
    return readSave("blob", shim);
  } catch {
    return null;
  }
}

export function createDrizzlePersistence(database: Db = liveDb()): Persistence {
  return {
    async loadWorld(worldId) {
      const [row] = await database.select().from(schema.worlds).where(eq(schema.worlds.id, worldId));
      if (!row) return null;
      return {
        id: row.id,
        seed: row.seed,
        worldType: row.worldType,
        difficulty: row.difficulty,
        hardcore: row.hardcore,
        save: row.saveBlob ? await parseSaveBlob(row.saveBlob) : null
      };
    },
    async storeWorld(worldId, blob, saveVersion) {
      // save_revision is bumped by the DB trigger (migration 0005) whenever
      // save_blob changes — the room is just another writer, and a browser
      // reading this world's blob compares that number. Not set here, so a
      // deploy where the trigger is present but this build isn't still counts.
      await database.update(schema.worlds).set({ saveBlob: blob, saveVersion, updatedAt: new Date() }).where(eq(schema.worlds.id, worldId));
    }
  };
}

/** FNV-1a of the world id — a stable seed for auto-created memory worlds. */
function seedFromId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 2147483647;
}

export function createMemoryPersistence(): Persistence & { blobs: Map<string, Uint8Array> } {
  const blobs = new Map<string, Uint8Array>();
  return {
    blobs,
    async loadWorld(worldId) {
      const blob = blobs.get(worldId);
      return {
        id: worldId,
        seed: seedFromId(worldId),
        worldType: "default",
        difficulty: "normal",
        hardcore: false,
        save: blob ? await parseSaveBlob(blob) : null
      };
    },
    async storeWorld(worldId, blob) {
      blobs.set(worldId, blob);
    }
  };
}
