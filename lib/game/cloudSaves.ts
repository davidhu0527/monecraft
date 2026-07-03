import type { SaveData } from "@/lib/game/types";

/**
 * Cloud sync for single-player saves: gzipped SaveData blobs pushed to
 * /api/worlds/:id/save with a last-write-wins stale guard. Each device
 * remembers the `updatedAt` stamp it last saw per cloud world (its sync
 * cursor); a 409 means another device wrote in between — the caller pulls
 * the newer save and lets the player continue from it.
 *
 * This module is transport only. Wiring into the world list / autosave path
 * lands with the online shell (the same GameShell rework that adds the
 * multiplayer world browser), so the sync UX ships in one piece.
 */

const STAMPS_KEY = "minecraft_cloud_stamps_v1";

type StampMap = Record<string, string>;

function readStamps(storage: Storage = localStorage): StampMap {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STAMPS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    const out: StampMap = {};
    for (const [key, value] of Object.entries(parsed)) if (typeof value === "string") out[key] = value;
    return out;
  } catch {
    return {};
  }
}

function writeStamp(cloudWorldId: string, stamp: string, storage: Storage = localStorage): void {
  const stamps = readStamps(storage);
  stamps[cloudWorldId] = stamp;
  storage.setItem(STAMPS_KEY, JSON.stringify(stamps));
}

export async function gzipJson(value: unknown): Promise<Uint8Array> {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzipJson<T>(bytes: Uint8Array): Promise<T> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return (await new Response(stream).json()) as T;
}

export type PushResult = "saved" | "conflict" | "error";

/** Uploads a save; "conflict" means another device wrote first — pull before retrying. */
export async function pushSave(cloudWorldId: string, save: SaveData, storage: Storage = localStorage): Promise<PushResult> {
  try {
    const body = await gzipJson(save);
    const base = readStamps(storage)[cloudWorldId] ?? "";
    const response = await fetch(`/api/worlds/${cloudWorldId}/save`, {
      method: "PUT",
      headers: {
        "content-type": "application/gzip",
        "x-save-version": String(save.version),
        "x-base-updated-at": base
      },
      body: body as unknown as BodyInit
    });
    if (response.status === 409) return "conflict";
    if (!response.ok) return "error";
    const { updatedAt } = (await response.json()) as { updatedAt: string };
    writeStamp(cloudWorldId, updatedAt, storage);
    return "saved";
  } catch {
    return "error";
  }
}

/** Downloads the latest cloud save (null when the world has no blob yet). Advances the sync cursor. */
export async function pullSave(cloudWorldId: string, storage: Storage = localStorage): Promise<SaveData | null> {
  try {
    const response = await fetch(`/api/worlds/${cloudWorldId}/save`);
    if (!response.ok) return null;
    const stamp = response.headers.get("x-updated-at");
    const save = await gunzipJson<SaveData>(new Uint8Array(await response.arrayBuffer()));
    if (stamp) writeStamp(cloudWorldId, stamp, storage);
    return save;
  } catch {
    return null;
  }
}
