import { parseSave } from "@/lib/game/save";
import type { SaveData } from "@/lib/game/types";

/**
 * Cloud sync for single-player saves: gzipped SaveData blobs pushed to
 * /api/worlds/:id/save with a last-write-wins stale guard. Each device
 * remembers the `saveRevision` it last saw per cloud world (its sync cursor);
 * a 409 means another device wrote in between — the caller pulls the newer
 * save and lets the player continue from it.
 *
 * The cursor is a save REVISION, not a timestamp. It used to be the world row's
 * `updatedAt`, which also served as metadata mtime — so renaming a world moved
 * every other device's cursor and 409'd its next push over a save that had not
 * changed, silently latching sync off for the session. A revision only moves
 * when the blob does.
 *
 * Wired into the shell: WorldSelect uploads an sp-cloud world (`pushSave`),
 * GameShell reconciles on open and on download (`pullCloudSaveIfNewer`), and
 * useMinecraftGame pushes on autosave/quit for a `WorldMeta.cloudId`-linked,
 * signed-in world.
 */

/**
 * v2: the values are revisions now, not ISO timestamps. A fresh key rather than
 * a migration — a stale timestamp compared against a revision would read as
 * "the cloud moved" forever. With no cursor, the open-time pull adopts and sets
 * one before anything pushes, so the cost of starting empty is nil.
 */
const STAMPS_KEY = "minecraft_cloud_stamps_v2";

type StampMap = Record<string, number>;

function readStamps(storage: Storage = localStorage): StampMap {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STAMPS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    const out: StampMap = {};
    for (const [key, value] of Object.entries(parsed)) if (Number.isInteger(value)) out[key] = value as number;
    return out;
  } catch {
    return {};
  }
}

function writeStamp(cloudWorldId: string, revision: number, storage: Storage = localStorage): void {
  const stamps = readStamps(storage);
  stamps[cloudWorldId] = revision;
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

/**
 * A downloaded blob is decoded input, not a SaveData — casting it was the one
 * save seam that skipped validation (the server's load path has always gone
 * through `readSave`). Anything that isn't a valid save reads as "no save
 * here", which the callers already handle as "keep what's local".
 */
async function gunzipSave(bytes: Uint8Array): Promise<SaveData | null> {
  return parseSave(await gunzipJson<unknown>(bytes));
}

export type PushResult = "saved" | "conflict" | "error";

/** Uploads a save; "conflict" means another device wrote first — pull before retrying. */
export async function pushSave(cloudWorldId: string, save: SaveData, storage: Storage = localStorage): Promise<PushResult> {
  try {
    const body = await gzipJson(save);
    // No cursor = we've never seen this world's blob, i.e. a first upload. The
    // server accepts that only against a never-saved world, so it can't clobber.
    const base = readStamps(storage)[cloudWorldId];
    const response = await fetch(`/api/worlds/${cloudWorldId}/save`, {
      method: "PUT",
      headers: {
        "content-type": "application/gzip",
        "x-save-version": String(save.version),
        "x-base-revision": base === undefined ? "" : String(base)
      },
      body: body as unknown as BodyInit
    });
    if (response.status === 409) return "conflict";
    if (!response.ok) return "error";
    const { saveRevision } = (await response.json()) as { saveRevision: number };
    writeStamp(cloudWorldId, saveRevision, storage);
    return "saved";
  } catch {
    return "error";
  }
}

/** Fetches the cloud blob + its revision (null when the world has no blob yet, the blob doesn't validate, or the fetch fails). */
async function fetchCloudSave(cloudWorldId: string): Promise<{ save: SaveData; saveRevision: number | null } | null> {
  try {
    const response = await fetch(`/api/worlds/${cloudWorldId}/save`);
    if (!response.ok) return null;
    const header = Number.parseInt(response.headers.get("x-save-revision") ?? "", 10);
    const save = await gunzipSave(new Uint8Array(await response.arrayBuffer()));
    if (!save) return null;
    return { save, saveRevision: Number.isInteger(header) ? header : null };
  } catch {
    return null;
  }
}

/**
 * `commitCursor` records that this device now holds the adopted save. The
 * caller MUST call it only after storing that save durably: the cursor is a
 * claim about what's on THIS device, so advancing it before the local write
 * commits means a failed write leaves us claiming a revision we don't have —
 * and every later open then reads the remote as "not ahead" and declines to
 * adopt it, stranding the cloud save permanently.
 */
export type PullDecision = { adopt: true; save: SaveData; commitCursor: () => void } | { adopt: false };

/**
 * Open-time reconcile: adopt the remote save ONLY when it advanced past what this
 * device last synced (its cursor). So re-opening a world you played offline keeps
 * your newer local progress instead of clobbering it with an older cloud copy;
 * a first download (no cursor yet) always adopts, and a genuine remote write from
 * another device wins (last-write-wins — the push side warns on the conflict).
 *
 * Revisions are ordered, so this asks whether the remote is strictly AHEAD of
 * the cursor rather than merely different — a remote behind our cursor (a
 * restored backup, a stale replica) leaves local progress alone.
 */
export async function pullCloudSaveIfNewer(cloudWorldId: string, storage: Storage = localStorage): Promise<PullDecision> {
  const result = await fetchCloudSave(cloudWorldId);
  if (!result) return { adopt: false }; // no blob yet, or offline → keep local
  const cursor = readStamps(storage)[cloudWorldId];
  const revision = result.saveRevision;
  if (revision === null) return { adopt: true, save: result.save, commitCursor: () => {} }; // no revision to reason about → first download
  if (cursor !== undefined && revision <= cursor) return { adopt: false }; // not ahead of our last sync
  return { adopt: true, save: result.save, commitCursor: () => writeStamp(cloudWorldId, revision, storage) };
}
