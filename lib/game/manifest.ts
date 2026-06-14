/**
 * Shared helpers for the versioned localStorage manifests (profiles, worlds).
 *
 * Each manifest is a `{ version, ...payload }` object living in its own key.
 * Reads must be *total* — a corrupt or absent blob falls back to a default,
 * never throws — and writes swallow quota/privacy-mode failures the same way
 * the audio and skin preferences do, so a failed persist never crashes the
 * game. Storage is injectable so the manifest modules can be unit-tested
 * without a browser.
 */

/** Per-call dependencies for manifest mutations — injectable for deterministic tests. */
export type ManifestDeps = {
  storage?: Storage;
  /** Wall clock for `createdAt`/`lastPlayedAt`; defaults to `Date.now`. */
  now?: () => number;
  /** Stable id generator; defaults to `crypto.randomUUID` with a random fallback. */
  uid?: () => string;
};

/** Resolves a `ManifestDeps` to concrete functions, applying the defaults. */
export function resolveDeps(deps: ManifestDeps = {}): { storage: Storage; now: () => number; uid: () => string } {
  return {
    storage: deps.storage ?? localStorage,
    now: deps.now ?? (() => Date.now()),
    uid: deps.uid ?? genId
  };
}

/** Reads and JSON-parses a manifest key, returning null on absence or any parse error. */
export function readManifestRaw(key: string, storage: Storage = localStorage): unknown {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Persists a manifest value, swallowing quota/privacy-mode failures. */
export function writeManifest(key: string, value: unknown, storage: Storage = localStorage): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota/privacy-mode failures lose the manifest write, never the game.
  }
}

/** A stable unique id — `crypto.randomUUID` when available, otherwise a random string. */
export function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/** Trims, collapses inner whitespace, and clamps a user-entered name to `max` chars. */
export function sanitizeName(value: unknown, fallback: string, max: number): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim().replace(/\s+/g, " ").slice(0, max);
  return cleaned.length > 0 ? cleaned : fallback;
}
