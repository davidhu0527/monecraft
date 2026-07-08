import { createIdbKv, type AsyncKv } from "./idbKv";
import { parseSave, readSave, writeSave } from "./save";
import { WORLD_SAVE_PREFIX, worldSaveKey } from "./worlds";
import type { SaveData } from "./types";

/**
 * Async world-save persistence: SaveData blobs live in IndexedDB (database
 * `monecraft`, object store `worldSaves`, keyed by worldId — including the
 * synthetic `cloud:<id>` ids), off localStorage's ~5-10 MB origin quota. The
 * profiles/worlds manifests stay in localStorage: they are tiny and read
 * synchronously during render; only the heavy blobs move.
 *
 * Invariants:
 * - Read-your-writes: write/remove/flushWrite record the pending value
 *   synchronously and read() returns it before consulting disk, so a remount
 *   (Fast Refresh, Load, world switch) can never see a stale blob — React runs
 *   the old mount's cleanup (which enqueues the write) before the new one reads.
 * - Latest-wins: rapid writes to one world coalesce; only the newest must land.
 *   write() resolves once that-or-newer data is durably committed.
 * - Migration is per-key copy-then-delete (the legacyMigration precedent): the
 *   localStorage original is removed only after the IndexedDB put commits, so a
 *   mid-migration failure can never lose the blob.
 * - No IndexedDB (some private modes): the store degrades for the session to
 *   the legacy localStorage keys — the old behavior, quota risk included.
 */
export type WorldSaveStore = {
  read(worldId: string): Promise<SaveData | null>;
  /** Queued, latest-wins; resolves when this-or-newer data is durable. */
  write(worldId: string, data: SaveData): Promise<void>;
  remove(worldId: string): Promise<void>;
  /**
   * Unload-safe fire-and-forget: starts the IndexedDB put synchronously so a
   * pagehide/visibilitychange handler (which cannot await) still commits.
   */
  flushWrite(worldId: string, data: SaveData): void;
  /** One-time localStorage→IndexedDB sweep of every world-save key; idempotent. */
  migrateAll(): Promise<void>;
};

export const SAVES_DB = "monecraft";
export const SAVES_STORE = "worldSaves";

export function createWorldSaveStore(deps: { kv?: AsyncKv; storage?: Storage } = {}): WorldSaveStore {
  const kv = deps.kv ?? createIdbKv(SAVES_DB, SAVES_STORE);
  // Lazy so importing this module never touches localStorage (SSR-safe).
  const ls = () => deps.storage ?? localStorage;

  // Pending value per world (null = tombstone). Set synchronously by every
  // mutation; read() short-circuits to it. Cleared only when that exact value
  // has durably landed, so a failed flush keeps serving the newest state from
  // memory while the next save retries the disk.
  const latest = new Map<string, SaveData | null>();
  const flushing = new Map<string, Promise<void>>();

  // The IDB-vs-fallback probe resolves once per session; the sync mirror lets
  // the unload path decide without awaiting.
  let fallbackKnown: boolean | null = null;
  let modeProbe: Promise<boolean> | null = null;
  const isFallback = (): Promise<boolean> => {
    modeProbe ??= kv.ready().then((ok) => {
      fallbackKnown = !ok;
      return !ok;
    });
    return modeProbe;
  };

  const removeLsKey = (worldId: string): void => {
    try {
      ls().removeItem(worldSaveKey(worldId));
    } catch {
      // A failed cleanup just leaves a shadowed copy; the next write retries.
    }
  };

  /** Drains this world's pending value; one loop per key, latest-wins. */
  const enqueueFlush = (worldId: string): Promise<void> => {
    const running = flushing.get(worldId);
    if (running) return running;
    const loop = (async () => {
      try {
        const fb = await isFallback();
        while (latest.has(worldId)) {
          const value = latest.get(worldId) as SaveData | null;
          if (value === null) {
            if (!fb) await kv.delete(worldId); // fallback: remove() already cleared the key
          } else if (fb) {
            writeSave(worldSaveKey(worldId), value, ls()); // quota throw rejects, like today
          } else {
            await kv.put(worldId, value);
          }
          if (latest.get(worldId) === value) {
            latest.delete(worldId);
            // The durable IDB copy supersedes any lingering localStorage
            // shadow (un-migrated original, or a failed earlier cleanup) —
            // drop it so the fallback read path can never resurrect stale
            // data, and to free quota.
            if (!fb && value !== null) removeLsKey(worldId);
          }
        }
      } finally {
        flushing.delete(worldId);
      }
    })();
    flushing.set(worldId, loop);
    return loop;
  };

  return {
    async read(worldId) {
      if (latest.has(worldId)) return latest.get(worldId) ?? null;
      if (await isFallback()) return readSave(worldSaveKey(worldId), ls());
      const record = await kv.get(worldId);
      // A write that landed while we awaited the disk is newer than the disk.
      if (latest.has(worldId)) return latest.get(worldId) ?? null;
      if (record !== undefined) return parseSave(record);
      // Not in IndexedDB yet: fall back to the legacy localStorage key and
      // lazily migrate it through the write queue (copy-then-delete).
      const legacy = readSave(worldSaveKey(worldId), ls());
      if (legacy) {
        latest.set(worldId, legacy);
        void enqueueFlush(worldId).catch(() => {});
      }
      return legacy;
    },

    write(worldId, data) {
      latest.set(worldId, data);
      return enqueueFlush(worldId);
    },

    remove(worldId) {
      // Clear the legacy key immediately (sync, cheap) so no fallback read can
      // see the blob again, then tombstone the IndexedDB record.
      removeLsKey(worldId);
      latest.set(worldId, null);
      return enqueueFlush(worldId);
    },

    flushWrite(worldId, data) {
      latest.set(worldId, data);
      if (fallbackKnown === true) {
        try {
          writeSave(worldSaveKey(worldId), data, ls());
          latest.delete(worldId);
        } catch {
          // Quota — the in-memory value still serves reads; autosave retries.
        }
        return;
      }
      // Start the put on the warm connection; a transaction created before
      // document teardown commits on its own. If the connection is cold (or
      // the mode is still unknown), fall back to the async queue — best
      // effort, backstopped by the 15s autosave.
      if (fallbackKnown === false && kv.tryPutSync(worldId, data)) return;
      void enqueueFlush(worldId).catch(() => {});
    },

    async migrateAll() {
      if (await isFallback()) return;
      const storage = ls();
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key?.startsWith(WORLD_SAVE_PREFIX)) keys.push(key);
      }
      for (const key of keys) {
        const worldId = key.slice(WORLD_SAVE_PREFIX.length);
        try {
          if (latest.has(worldId)) continue; // an open world's writes already cover it
          if ((await kv.get(worldId)) !== undefined) continue; // already migrated
          const data = readSave(key, storage);
          if (!data) continue; // never destroy a blob we couldn't parse
          latest.set(worldId, data);
          await enqueueFlush(worldId);
        } catch {
          // This key stays in localStorage (still readable via the fallback
          // path); the next session's sweep retries it.
        }
      }
    }
  };
}

/** The app-wide store. Construction is lazy inside — importing this is SSR-safe. */
export const worldSaves: WorldSaveStore = createWorldSaveStore();

/**
 * Opportunistically ask the browser not to evict our origin's storage under
 * pressure. Chrome decides silently; Firefox may prompt — call it only for
 * players who already have a world.
 */
export function requestPersistentStorage(): void {
  if (typeof navigator === "undefined") return;
  try {
    void navigator.storage?.persist?.().catch(() => {});
  } catch {
    // Older engines without the Storage API.
  }
}
