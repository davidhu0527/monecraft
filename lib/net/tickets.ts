/**
 * Join tickets: the only trust link between the web app and the game server.
 *
 * The Next.js API (which can read the browser's session cookie) mints a
 * short-lived HS256 token naming the player and the world; the game server
 * (which never sees cookies) verifies the signature with the shared
 * GAME_TICKET_SECRET and admits the socket. Stateless by design — the two
 * deployments never talk to each other at runtime.
 *
 * Web Crypto only (no jwt dependency): runs identically on Vercel's Node
 * runtime, Bun, and the browser-adjacent test environments.
 */

export const TICKET_TTL_SECONDS = 60;

export type TicketClaims = {
  /** The player's user id (becomes their PlayerId in the world). */
  sub: string;
  /** The world (= room) this ticket admits into. */
  wid: string;
  /** Display name at mint time. */
  name: string;
  /** Skin palette id, if the account has one. */
  skinId: string | null;
  /** Room role — the owner may kick/close. */
  role: "owner" | "member";
  /** Protocol version the client was built against. */
  pv: number;
  iat: number;
  exp: number;
};

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array {
  const padded = text
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** Mints a signed ticket. `now` is injectable for expiry tests. */
export async function signTicket(claims: Omit<TicketClaims, "iat" | "exp">, secret: string, now: number = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  const full: TicketClaims = { ...claims, iat, exp: iat + TICKET_TTL_SECONDS };
  const header = base64url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = base64url(encoder.encode(JSON.stringify(full)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

/**
 * Verifies signature and expiry, returning the claims — or null for anything
 * malformed, tampered, or stale. Total: never throws on hostile input.
 */
export async function verifyTicket(ticket: string, secret: string, now: number = Date.now()): Promise<TicketClaims | null> {
  try {
    const parts = ticket.split(".");
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      fromBase64url(signature) as unknown as ArrayBuffer,
      encoder.encode(`${header}.${payload}`)
    );
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as TicketClaims;
    if (typeof claims.sub !== "string" || !claims.sub) return null;
    if (typeof claims.wid !== "string" || !claims.wid) return null;
    if (claims.role !== "owner" && claims.role !== "member") return null;
    if (typeof claims.pv !== "number") return null;
    if (typeof claims.exp !== "number" || Math.floor(now / 1000) >= claims.exp) return null;
    return claims;
  } catch {
    return null;
  }
}
