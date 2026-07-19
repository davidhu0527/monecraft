import { afterEach, describe, expect, test } from "bun:test";
import { gunzipJson, gzipJson, pullCloudSaveIfNewer } from "./cloudSaves";
import type { SaveData } from "@/lib/game/types";

const REV_KEY = (id: string) => `minecraft_cloud_rev_${id}`; // per-world revision cursor
const LEGACY_KEY = "minecraft_cloud_stamps_v1"; // pre-revision: shared map of ISO timestamps (read-only bridge)

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

  /** Stub the cloud GET with a gzipped body + x-save-revision + x-updated-at headers. */
  function stubBody(body: unknown, saveRevision: number | null, updatedAt: string | null = null, ok = true): void {
    globalThis.fetch = (async () => {
      const bytes = await gzipJson(body);
      return {
        ok,
        headers: {
          get: (key: string) => (key === "x-save-revision" ? (saveRevision !== null ? String(saveRevision) : null) : key === "x-updated-at" ? updatedAt : null)
        },
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  /** The common case: a valid save. */
  function stubCloud(saveRevision: number | null, updatedAt: string | null = null, ok = true): void {
    stubBody(save, saveRevision, updatedAt, ok);
  }

  test("first download (no cursor) adopts the remote save and records the revision on commit", async () => {
    const storage = fakeStorage();
    stubCloud(3);
    const decision = await pullCloudSaveIfNewer("c1", false, storage);
    expect(decision.kind).toBe("adopt");
    if (decision.kind === "adopt") {
      expect(decision.save.version).toBe(18);
      decision.commitCursor();
    }
    expect(storage.getItem(REV_KEY("c1"))).toBe("3");
  });

  // The cursor claims "this device HOLDS revision N". Advancing it before the
  // local write commits means a failed write leaves us claiming a save we don't
  // have — and every later open then reads the remote as "not ahead" and
  // declines to adopt it, stranding the cloud save on this device forever.
  test("the cursor only moves when the caller commits it (a failed local write leaves it put)", async () => {
    const storage = fakeStorage();
    stubCloud(3);
    const decision = await pullCloudSaveIfNewer("c1", false, storage);
    expect(decision.kind).toBe("adopt");
    // Caller got the save but never committed — e.g. its IndexedDB write threw.
    expect(storage.getItem(REV_KEY("c1"))).toBeNull();

    // So the next open still adopts, rather than writing us off as up to date.
    stubCloud(3);
    expect((await pullCloudSaveIfNewer("c1", false, storage)).kind).toBe("adopt");
  });

  test("keeps local when the remote is unchanged since this device's cursor", async () => {
    const storage = fakeStorage({ [REV_KEY("c1")]: "3" });
    stubCloud(3); // the same revision we last synced
    expect((await pullCloudSaveIfNewer("c1", false, storage)).kind).toBe("keep-local");
  });

  test("adopts when another device advanced the remote past the cursor", async () => {
    const storage = fakeStorage({ [REV_KEY("c1")]: "3" });
    stubCloud(4); // ahead of the cursor
    expect((await pullCloudSaveIfNewer("c1", false, storage)).kind).toBe("adopt");
  });

  // Revisions are ordered, so "different" isn't the question — "ahead" is. A
  // remote BEHIND our cursor (a restored backup, a stale replica) must not
  // overwrite newer local progress; the old timestamp cursor compared with ===
  // and would have adopted it.
  test("keeps local when the remote is behind the cursor", async () => {
    const storage = fakeStorage({ [REV_KEY("c1")]: "9" });
    stubCloud(4);
    expect((await pullCloudSaveIfNewer("c1", false, storage)).kind).toBe("keep-local");
    expect(storage.getItem(REV_KEY("c1"))).toBe("9"); // cursor unmoved
  });

  // Per-world keys (not one shared blob): a write to one world's cursor can't
  // clobber another's — the cross-tab read-modify-write race is gone.
  test("cursors are per world — advancing one leaves another's untouched", async () => {
    const storage = fakeStorage({ [REV_KEY("c1")]: "3", [REV_KEY("c2")]: "7" });
    stubCloud(4); // c1 advanced
    const decision = await pullCloudSaveIfNewer("c1", false, storage);
    if (decision.kind === "adopt") decision.commitCursor();
    expect(storage.getItem(REV_KEY("c1"))).toBe("4"); // c1 moved
    expect(storage.getItem(REV_KEY("c2"))).toBe("7"); // c2 untouched
  });

  test("keeps local when the world has no blob yet or the fetch fails", async () => {
    const storage = fakeStorage();
    stubCloud(null, null, false); // ok = false
    expect((await pullCloudSaveIfNewer("c1", false, storage)).kind).toBe("keep-local");
  });

  // The upgrade transition: a device that synced under the OLD timestamp scheme
  // has a durable local save and a legacy timestamp T, but no revision cursor.
  // The revision alone can't say whether local descends from the current cloud —
  // the legacy T vs the server's mtime U decides, and where it can't, the player does.
  describe("upgraded device: local save + legacy timestamp, no revision cursor", () => {
    const T = "2026-01-01T00:00:00.000Z";
    const legacy = { [LEGACY_KEY]: JSON.stringify({ c1: T }) };

    test("cloud UNCHANGED since our last sync (U ≤ T) → keeps local and seeds the revision cursor", async () => {
      const storage = fakeStorage(legacy);
      stubCloud(5, T); // U == T: the cloud is exactly what we last synced
      const decision = await pullCloudSaveIfNewer("c1", true, storage);
      expect(decision.kind).toBe("keep-local"); // local (a descendant of the cloud) survives
      expect(storage.getItem(REV_KEY("c1"))).toBe("5"); // seeded — the next push has a real base, not a 409-loop
    });

    // U > T is ambiguous: `updatedAt` also moves on a RENAME (metadata mtime), so
    // it could be genuinely-newer cloud content OR an unchanged blob whose row was
    // renamed while this device has newer offline edits. Round 4 auto-adopted here
    // and could clobber newer local on a rename-only bump — so now the player picks.
    test("cloud may have DIVERGED (U > T) → conflict; the resolvers seed the cursor either way", async () => {
      const storage = fakeStorage(legacy);
      stubCloud(6, "2026-02-01T00:00:00.000Z"); // U > T
      const decision = await pullCloudSaveIfNewer("c1", true, storage);
      expect(decision.kind).toBe("conflict");
      if (decision.kind === "conflict") {
        expect(decision.cloudSave.version).toBe(18); // the cloud copy is offered as the choice
        decision.commitCursor(); // keep-local or take-cloud both call this
        expect(storage.getItem(REV_KEY("c1"))).toBe("6"); // seeded so sync works after the choice
      }
    });

    // No legacy timestamp to prove local descends from the cloud → also a conflict.
    test("no legacy timestamp → conflict rather than risk clobbering either side", async () => {
      const storage = fakeStorage(); // no legacy, no revision cursor
      stubCloud(5, "2026-02-01T00:00:00.000Z");
      expect((await pullCloudSaveIfNewer("c1", true, storage)).kind).toBe("conflict");
    });

    // A device with no cursor AND no local save is genuinely fresh (or a
    // re-download after deleting the local copy) — adopt, no prompt.
    test("still adopts when there is no local save (a genuine fresh device)", async () => {
      const storage = fakeStorage();
      stubCloud(5, T);
      expect((await pullCloudSaveIfNewer("c1", false, storage)).kind).toBe("adopt");
    });
  });

  // The download used to be a bare cast: whatever JSON came back WAS a SaveData
  // as far as the type system knew, so a malformed blob rode into the engine and
  // threw there. It now goes through parseSave like every other save seam, so a
  // recoverable blob is sanitized BEFORE the engine sees it...
  test("sanitizes a recoverable remote blob rather than handing the engine a null player", async () => {
    const storage = fakeStorage();
    stubBody({ version: 18, seed: 1, changes: [1], players: [null] }, 4, null);
    const decision = await pullCloudSaveIfNewer("c1", false, storage);
    expect(decision.kind).toBe("adopt");
    if (decision.kind === "adopt") {
      expect(decision.save.players).toEqual([]);
      expect(decision.save.changes).toEqual([]);
    }
  });

  // ...and one that isn't a save at all is refused outright.
  test("refuses a remote blob that isn't a save, and doesn't advance the cursor", async () => {
    const storage = fakeStorage();
    stubBody({ hello: "world" }, 4, null);
    expect((await pullCloudSaveIfNewer("c1", false, storage)).kind).toBe("keep-local");
    // A refused blob must not move the cursor — the next open has to retry.
    expect(storage.getItem(REV_KEY("c1"))).toBeNull();
  });
});
