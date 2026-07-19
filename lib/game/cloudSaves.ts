import { parseSave } from "@/lib/game/save";
import type { SaveData } from "@/lib/game/types";

/**
 * Cloud sync for single-player saves: gzipped SaveData blobs pushed to
 * /api/worlds/:id/save with a last-write-wins stale guard. Each local save copy
 * remembers the `saveRevision` it last saw (its sync cursor, keyed by the local
 * IndexedDB key, not the cloud id — see below); a 409 means another device wrote
 * in between — the caller pulls the newer save and lets the player continue.
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
 * The revision cursor is stored under its own key (`minecraft_cloud_rev_<scope>`),
 * NOT one shared JSON blob. A shared blob is a read-modify-write: two tabs saving
 * different worlds both read the map and write back, and the second clobbers the
 * first's entry — the lost world then pushes with an empty base, 409s, and
 * latches sync off. Independent keys make each write touch only its own scope.
 *
 * The scope is the **local save instance** (its IndexedDB key), not the cloud
 * world id: one device can hold two local copies of one cloud world — the
 * account-mode cache (`cloud:<id>`) and a downloaded local world (`<uid>`, linked
 * by cloudId) — and each has its own sync state. Keying the cursor by cloud id
 * made them share one, so a stale copy could push past the other's base and
 * silently overwrite cloud progress. The cursor tracks "what THIS local copy last
 * synced"; the cloud id only names which server world to fetch/push.
 */
const REV_KEY_PREFIX = "minecraft_cloud_rev_";

/**
 * The pre-revision cursor: a shared JSON map of ISO timestamps (the world row's
 * `updatedAt` each device last saw). Still on upgraded devices; read ONLY to
 * bridge the one-time transition to revision cursors — never written.
 */
const LEGACY_STAMPS_KEY = "minecraft_cloud_stamps_v1";

function readRevision(scope: string, storage: Storage = localStorage): number | undefined {
  const raw = storage.getItem(REV_KEY_PREFIX + scope);
  if (raw === null) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) ? n : undefined;
}

function writeRevision(scope: string, revision: number, storage: Storage = localStorage): void {
  storage.setItem(REV_KEY_PREFIX + scope, String(revision));
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

/**
 * Uploads a save; "conflict" means another device wrote first — pull before
 * retrying. `localScope` is this local copy's IndexedDB key: it scopes the sync
 * cursor so two local copies of one cloud world don't share (and clobber) a base.
 */
export async function pushSave(cloudWorldId: string, localScope: string, save: SaveData, storage: Storage = localStorage): Promise<PushResult> {
  try {
    const body = await gzipJson(save);
    // No cursor = this local copy has never seen the world's blob, i.e. a first
    // upload. The server accepts that only against a never-saved world, so it
    // can't clobber.
    const base = readRevision(localScope, storage);
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
    writeRevision(localScope, saveRevision, storage);
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
 * The open-time reconcile's verdict:
 *  - `adopt` — take the remote save; the caller writes it locally, then calls
 *    `commitCursor` (only after that write durably commits — the cursor claims
 *    THIS device holds the revision, so advancing it past a failed write would
 *    make every later open read the remote as "not ahead" and decline to adopt,
 *    stranding the cloud save).
 *  - `keep-local` — this device's save is at least as new; leave it untouched.
 *  - `conflict` — an upgrade where local and cloud may have DIVERGED and the
 *    timestamps can't say which is newer (see below). The caller asks the player
 *    to choose, then either writes `cloudSave` (take cloud) or keeps local; both
 *    call `commitCursor` to seed the revision so sync works afterward — not a
 *    false claim, because the player has explicitly resolved which content wins.
 */
export type PullDecision =
  | { kind: "adopt"; save: SaveData; commitCursor: () => void }
  | { kind: "keep-local" }
  | { kind: "conflict"; cloudSave: SaveData; commitCursor: () => void };

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
 * cursor T against the server's mtime U gets us most of the way:
 *   - U ≤ T (cloud unchanged since our last sync): local descends from it → keep
 *     local and seed the revision cursor. A later push to R+1 is a legit
 *     continuation, not a false claim.
 *   - U > T, or no T: the cloud MAY have advanced — but U also moves on a rename
 *     (metadata mtime), so "advanced" is ambiguous: it could be genuinely-newer
 *     cloud content, or an unchanged blob whose row was renamed while this device
 *     has newer offline edits. There is no un-contaminated timestamp to tell them
 *     apart, so rather than auto-pick (and risk clobbering either side), return
 *     `conflict` and let the player choose.
 */
export async function pullCloudSaveIfNewer(
  cloudWorldId: string,
  localScope: string,
  hasLocalSave: boolean,
  storage: Storage = localStorage
): Promise<PullDecision> {
  const result = await fetchCloudSave(cloudWorldId);
  if (!result) return { kind: "keep-local" }; // no blob yet, or offline → keep local
  const cursor = readRevision(localScope, storage);
  const revision = result.saveRevision;
  const seedCursor = () => {
    if (revision !== null) writeRevision(localScope, revision, storage);
  };
  if (cursor === undefined && hasLocalSave) {
    // Ambiguous upgrade — decide with the legacy timestamp cursor vs server mtime.
    // The legacy stamp map predates per-instance cursors and is keyed by cloud id.
    const legacyT = readLegacyTimestamp(cloudWorldId, storage);
    const cloudUnchanged = legacyT !== undefined && result.updatedAt !== null && result.updatedAt <= legacyT;
    if (cloudUnchanged) {
      seedCursor(); // keep local, seed (honest — local descends from the cloud)
      return { kind: "keep-local" };
    }
    // Diverged, and the timestamps can't say which is newer → the player chooses.
    return { kind: "conflict", cloudSave: result.save, commitCursor: seedCursor };
  }
  if (revision === null) return { kind: "adopt", save: result.save, commitCursor: () => {} }; // no revision to reason about → first download
  if (cursor !== undefined && revision <= cursor) return { kind: "keep-local" }; // not ahead of our last sync
  return { kind: "adopt", save: result.save, commitCursor: seedCursor };
}
