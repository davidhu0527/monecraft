import { afterEach, describe, expect, test } from "bun:test";
import { gunzipJson, gzipJson, pullCloudSaveIfNewer } from "./cloudSaves";
import type { SaveData } from "@/lib/game/types";

const STAMPS_KEY = "minecraft_cloud_stamps_v2";

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value)
  };
}

describe("cloud save codec", () => {
  test("gzip round-trips a save-shaped object and actually compresses", async () => {
    const save = {
      version: 17,
      seed: 1337,
      changes: Array.from({ length: 2000 }, (_, i) => [i, i % 5]),
      players: [{ id: "local", hearts: 20 }]
    };
    const bytes = await gzipJson(save);
    // Repetitive block diffs are the whole payload story — they must shrink.
    expect(bytes.byteLength).toBeLessThan(JSON.stringify(save).length / 2);
    const back = await gunzipJson<typeof save>(bytes);
    expect(back).toEqual(save);
  });

  test("gunzip rejects garbage by throwing (callers catch to null)", async () => {
    await expect(gunzipJson(new Uint8Array([1, 2, 3]))).rejects.toBeDefined();
  });
});

describe("pullCloudSaveIfNewer (open-time reconcile)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // A *valid* save: `players` is required, and the download now validates
  // through parseSave like every other save seam — a fixture the engine would
  // reject can't stand in for one the cloud hands us.
  const save = { version: 18, seed: 1, changes: [], players: [] } as unknown as SaveData;

  /** Stub fetch to answer the cloud GET with an arbitrary gzipped body + an x-save-revision header. */
  function stubBody(body: unknown, saveRevision: number | null, ok = true): void {
    globalThis.fetch = (async () => {
      const bytes = await gzipJson(body);
      return {
        ok,
        headers: { get: (key: string) => (key === "x-save-revision" && saveRevision !== null ? String(saveRevision) : null) },
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  /** The common case: a valid save. */
  function stubCloud(saveRevision: number | null, ok = true): void {
    stubBody(save, saveRevision, ok);
  }

  test("first download (no cursor) adopts the remote save and records the revision on commit", async () => {
    const storage = fakeStorage();
    stubCloud(3);
    const decision = await pullCloudSaveIfNewer("c1", storage);
    expect(decision.adopt).toBe(true);
    if (decision.adopt) {
      expect(decision.save.version).toBe(18);
      decision.commitCursor();
    }
    expect(JSON.parse(storage.getItem(STAMPS_KEY)!).c1).toBe(3);
  });

  // The cursor claims "this device HOLDS revision N". Advancing it before the
  // local write commits means a failed write leaves us claiming a save we don't
  // have — and every later open then reads the remote as "not ahead" and
  // declines to adopt it, stranding the cloud save on this device forever.
  test("the cursor only moves when the caller commits it (a failed local write leaves it put)", async () => {
    const storage = fakeStorage();
    stubCloud(3);
    const decision = await pullCloudSaveIfNewer("c1", storage);
    expect(decision.adopt).toBe(true);
    // Caller got the save but never committed — e.g. its IndexedDB write threw.
    expect(storage.getItem(STAMPS_KEY)).toBeNull();

    // So the next open still adopts, rather than writing us off as up to date.
    stubCloud(3);
    expect((await pullCloudSaveIfNewer("c1", storage)).adopt).toBe(true);
  });

  test("keeps local when the remote is unchanged since this device's cursor", async () => {
    const storage = fakeStorage({ [STAMPS_KEY]: JSON.stringify({ c1: 3 }) });
    stubCloud(3); // the same revision we last synced
    expect((await pullCloudSaveIfNewer("c1", storage)).adopt).toBe(false);
  });

  test("adopts when another device advanced the remote past the cursor", async () => {
    const storage = fakeStorage({ [STAMPS_KEY]: JSON.stringify({ c1: 3 }) });
    stubCloud(4); // ahead of the cursor
    expect((await pullCloudSaveIfNewer("c1", storage)).adopt).toBe(true);
  });

  // Revisions are ordered, so "different" isn't the question — "ahead" is. A
  // remote BEHIND our cursor (a restored backup, a stale replica) must not
  // overwrite newer local progress; the old timestamp cursor compared with ===
  // and would have adopted it.
  test("keeps local when the remote is behind the cursor", async () => {
    const storage = fakeStorage({ [STAMPS_KEY]: JSON.stringify({ c1: 9 }) });
    stubCloud(4);
    expect((await pullCloudSaveIfNewer("c1", storage)).adopt).toBe(false);
    expect(JSON.parse(storage.getItem(STAMPS_KEY)!).c1).toBe(9); // cursor unmoved
  });

  test("keeps local when the world has no blob yet or the fetch fails", async () => {
    const storage = fakeStorage();
    stubCloud(null, false);
    expect((await pullCloudSaveIfNewer("c1", storage)).adopt).toBe(false);
  });

  // The download used to be a bare cast: whatever JSON came back WAS a SaveData
  // as far as the type system knew, so a malformed blob rode into the engine and
  // threw there. It now goes through parseSave like every other save seam, so a
  // recoverable blob is sanitized BEFORE the engine sees it...
  test("sanitizes a recoverable remote blob rather than handing the engine a null player", async () => {
    const storage = fakeStorage();
    stubBody({ version: 18, seed: 1, changes: [1], players: [null] }, 4);
    const decision = await pullCloudSaveIfNewer("c1", storage);
    expect(decision.adopt).toBe(true);
    if (decision.adopt) {
      expect(decision.save.players).toEqual([]);
      expect(decision.save.changes).toEqual([]);
    }
  });

  // ...and one that isn't a save at all is refused outright.
  test("refuses a remote blob that isn't a save, and doesn't advance the cursor", async () => {
    const storage = fakeStorage();
    stubBody({ hello: "world" }, 4);
    expect((await pullCloudSaveIfNewer("c1", storage)).adopt).toBe(false);
    // A refused blob must not move the cursor — the next open has to retry.
    expect(storage.getItem(STAMPS_KEY)).toBeNull();
  });
});
