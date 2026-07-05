import { eq } from "drizzle-orm";
import { db as liveDb, schema, type Db } from "@/db";
import { readSave } from "@/lib/game/save";
import type { SaveData } from "@/lib/game/types";
import { gunzipWorldSync } from "@/lib/net/codec";

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

/** Parses a stored gzipped SaveData blob through the full readSave validation/migration chain. */
export async function parseSaveBlob(blob: Uint8Array): Promise<SaveData | null> {
  try {
    // Reuse gunzip; then readSave via a one-key Storage shim so the entire
    // migration + validation pipeline applies to server-loaded saves too.
    const bun = typeof Bun !== "undefined" ? (Bun as unknown as { gunzipSync(d: Uint8Array): Uint8Array }) : null;
    const json = bun ? new TextDecoder().decode(bun.gunzipSync(blob)) : JSON.stringify(await gunzipWorldSync(blob)); // never taken on Bun; keeps the module portable
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
