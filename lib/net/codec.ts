import { readClientMessage, type ClientMessage, type ServerMessage, type WorldSync } from "./protocol";

/**
 * Frame encoding. v1: JSON text frames for everything except the join
 * world-sync, which is one gzipped binary frame (a fresh world's block diff
 * is tiny, but a terraformed one isn't — and block diffs gzip extremely
 * well). Both runtimes are covered: Bun's native zlib on the server,
 * CompressionStream/DecompressionStream in the browser.
 */

/**
 * Wire-size quantizers for replicated poses. Raw doubles serialize at up to
 * 17 chars ("256.04500000000002"); rounding before JSON.stringify keeps the
 * envelope shape identical while cutting pose payloads roughly in half.
 * Precision margins: 1 cm ≪ every movement clamp and deadband in play.
 */
export const qPos = (v: number): number => Math.round(v * 100) / 100;
/** 3-decimal angle/velocity quantizer (~0.06° — invisible at render scale). */
export const qAng = (v: number): number => Math.round(v * 1000) / 1000;

export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

export function encodeClientMessage(message: ClientMessage): string {
  return JSON.stringify(message);
}

/** Parses + validates one client text frame; null for binary/garbage/off-spec. */
export function decodeClientFrame(data: unknown): ClientMessage | null {
  if (typeof data !== "string") return null;
  try {
    return readClientMessage(JSON.parse(data));
  } catch {
    return null;
  }
}

/** Parses one server text frame (the client trusts its server; shape only). */
export function decodeServerFrame(data: unknown): ServerMessage | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data) as ServerMessage;
    return parsed && typeof parsed === "object" && typeof parsed.t === "string" ? parsed : null;
  } catch {
    return null;
  }
}

type BunGlobal = { gzipSync(data: Uint8Array): Uint8Array; gunzipSync(data: Uint8Array): Uint8Array };
const bunZlib = (): BunGlobal | null => (typeof Bun !== "undefined" ? (Bun as unknown as BunGlobal) : null);

/** Gzips the world-sync payload into the one binary frame of the protocol. */
export async function gzipWorldSync(sync: WorldSync): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify(sync));
  const bun = bunZlib();
  if (bun) return bun.gzipSync(json);
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reverses gzipWorldSync. Null for garbage (a client should resync, not crash). */
export async function gunzipWorldSync(bytes: Uint8Array): Promise<WorldSync | null> {
  try {
    const bun = bunZlib();
    let json: Uint8Array;
    if (bun) {
      json = bun.gunzipSync(bytes);
    } else {
      const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
      json = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    const parsed = JSON.parse(new TextDecoder().decode(json)) as WorldSync;
    return parsed && parsed.t === "worldSync" && Array.isArray(parsed.changes) ? parsed : null;
  } catch {
    return null;
  }
}
