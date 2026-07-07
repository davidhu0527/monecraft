import { afterEach, describe, expect, test } from "bun:test";
import { gunzipJson, gzipJson, pullCloudSaveIfNewer } from "./cloudSaves";
import type { SaveData } from "@/lib/game/types";

const STAMPS_KEY = "minecraft_cloud_stamps_v1";

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

  const save = { version: 18, seed: 1, changes: [] } as unknown as SaveData;

  /** Stub fetch to answer the cloud GET with a gzipped save + an x-updated-at header. */
  function stubCloud(updatedAt: string | null, ok = true): void {
    globalThis.fetch = (async () => {
      const bytes = await gzipJson(save);
      return {
        ok,
        headers: { get: (key: string) => (key === "x-updated-at" ? updatedAt : null) },
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  test("first download (no cursor) adopts the remote save and records the stamp", async () => {
    const storage = fakeStorage();
    stubCloud("2026-01-01T00:00:00Z");
    const decision = await pullCloudSaveIfNewer("c1", storage);
    expect(decision.adopt).toBe(true);
    if (decision.adopt) expect(decision.save.version).toBe(18);
    expect(JSON.parse(storage.getItem(STAMPS_KEY)!).c1).toBe("2026-01-01T00:00:00Z");
  });

  test("keeps local when the remote is unchanged since this device's cursor", async () => {
    const storage = fakeStorage({ [STAMPS_KEY]: JSON.stringify({ c1: "2026-01-01T00:00:00Z" }) });
    stubCloud("2026-01-01T00:00:00Z"); // same stamp we last synced
    expect((await pullCloudSaveIfNewer("c1", storage)).adopt).toBe(false);
  });

  test("adopts when another device advanced the remote past the cursor", async () => {
    const storage = fakeStorage({ [STAMPS_KEY]: JSON.stringify({ c1: "2026-01-01T00:00:00Z" }) });
    stubCloud("2026-02-02T00:00:00Z"); // newer than the cursor
    expect((await pullCloudSaveIfNewer("c1", storage)).adopt).toBe(true);
  });

  test("keeps local when the world has no blob yet or the fetch fails", async () => {
    const storage = fakeStorage();
    stubCloud(null, false);
    expect((await pullCloudSaveIfNewer("c1", storage)).adopt).toBe(false);
  });
});
