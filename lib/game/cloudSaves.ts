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
 * when the blob does. It is stored per world (independent keys, not one shared
 * blob), and a device upgrading off the legacy timestamp scheme bridges via the
 * server's mtime (see `pullCloudSaveIfNewer`).
 *
 * Wired into the shell: WorldSelect uploads an sp-cloud world (`pushSave`),
 * GameShell reconciles on open and on download (`pullCloudSaveIfNewer`), and
 * useMinecraftGame pushes on autosave/quit for a `WorldMeta.cloudId`-linked,
 * signed-in world.
 */

/**
 * The revision cursor is stored **per world**, under its own key
 * (`minecraft_cloud_rev_<id>`), NOT one shared JSON blob. A shared blob is a
 * read-modify-write: two tabs saving different worlds both read the map and
 * write back, and the second clobbers the first's entry — the lost world then
 * pushes with an empty base, 409s, and latches sync off. Independent keys make
 * each write touch only its own world.
 */
const REV_KEY_PREFIX = "minecraft_cloud_rev_";

/**
 * The pre-revision cursor: a shared JSON map of ISO timestamps (the world row's
 * `updatedAt` each device last saw). Still on upgraded devices; read ONLY to
 * bridge the one-time transition to revision cursors — never written.
 */
const LEGACY_STAMPS_KEY = "minecraft_cloud_stamps_v1";

function readRevision(cloudWorldId: string, storage: Storage = localStorage): number | undefined {
  const raw = storage.getItem(REV_KEY_PREFIX + cloudWorldId);
  if (raw === null) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) ? n : undefined;
}

function writeRevision(cloudWorldId: string, revision: number, storage: Storage = localStorage): void {
  storage.setItem(REV_KEY_PREFIX + cloudWorldId, String(revision));
}

/** This world's legacy timestamp cursor (the `updatedAt` last synced under the old scheme), or undefined. */
function readLegacyTimestamp(cloudWorldId: string, storage: Storage = localStorage): string | undefined {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(LEGACY_STAMPS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return undefined;
    const value = (parsed as Record<string, unknown>)[cloudWorldId];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
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
    const base = readRevision(cloudWorldId, storage);
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
    writeRevision(cloudWorldId, saveRevision, storage);
    return "saved";
  } catch {
    return "error";
  }
}

/** Fetches the cloud blob + its revision + mtime (null when the world has no blob yet, the blob doesn't validate, or the fetch fails). */
async function fetchCloudSave(cloudWorldId: string): Promise<{ save: SaveData; saveRevision: number | null; updatedAt: string | null } | null> {
  try {
    const response = await fetch(`/api/worlds/${cloudWorldId}/save`);
    if (!response.ok) return null;
    const header = Number.parseInt(response.headers.get("x-save-revision") ?? "", 10);
    const updatedAt = response.headers.get("x-updated-at");
    const save = await gunzipSave(new Uint8Array(await response.arrayBuffer()));
    if (!save) return null;
    return { save, saveRevision: Number.isInteger(header) ? header : null, updatedAt };
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
 *
 * `supersededLocal` is set only on the ambiguous-upgrade adopt path below: the
 * cloud had advanced past this device's last sync, so adopting it may have
 * replaced unsynced local changes — the caller warns the player.
 */
export type PullDecision = { adopt: true; save: SaveData; commitCursor: () => void; supersededLocal?: boolean } | { adopt: false };

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
 *
 * `hasLocalSave` disambiguates the one case a missing revision cursor can't: a
 * genuinely fresh device (no local, no cursor → first download, adopt) from an
 * upgraded device that synced under the OLD timestamp cursor scheme (local
 * exists, no revision cursor yet). For that upgrade, the revision alone can't
 * say whether local descends from the current cloud — but the legacy timestamp
 * cursor T can, against the server's mtime U:
 *   - U ≤ T (cloud unchanged since our last sync): local descends from it → keep
 *     local and seed the revision cursor. A later push to R+1 is a legit
 *     continuation, not a false claim.
 *   - U > T, or no T: the cloud advanced (another device wrote) → ADOPT it; never
 *     seed a cursor for content this device doesn't hold, which is what let a
 *     stale local push silently clobber newer cloud work. Warn (supersededLocal).
 */
export async function pullCloudSaveIfNewer(cloudWorldId: string, hasLocalSave: boolean, storage: Storage = localStorage): Promise<PullDecision> {
  const result = await fetchCloudSave(cloudWorldId);
  if (!result) return { adopt: false }; // no blob yet, or offline → keep local
  const cursor = readRevision(cloudWorldId, storage);
  const revision = result.saveRevision;
  if (cursor === undefined && hasLocalSave) {
    // Ambiguous upgrade — decide with the legacy timestamp cursor vs server mtime.
    const legacyT = readLegacyTimestamp(cloudWorldId, storage);
    const cloudUnchanged = legacyT !== undefined && result.updatedAt !== null && result.updatedAt <= legacyT;
    if (cloudUnchanged) {
      if (revision !== null) writeRevision(cloudWorldId, revision, storage); // keep local, seed (honest)
      return { adopt: false };
    }
    // Cloud advanced or unprovable descent → adopt so we can't clobber it; warn.
    const commitCursor = revision !== null ? () => writeRevision(cloudWorldId, revision, storage) : () => {};
    return { adopt: true, save: result.save, commitCursor, supersededLocal: true };
  }
  if (revision === null) return { adopt: true, save: result.save, commitCursor: () => {} }; // no revision to reason about → first download
  if (cursor !== undefined && revision <= cursor) return { adopt: false }; // not ahead of our last sync
  return { adopt: true, save: result.save, commitCursor: () => writeRevision(cloudWorldId, revision, storage) };
}
