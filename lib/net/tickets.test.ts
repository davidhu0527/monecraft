import { describe, expect, test } from "bun:test";
import { signTicket, TICKET_TTL_SECONDS, verifyTicket, type TicketClaims } from "./tickets";

const SECRET = "ticket-secret-for-tests";
const claims: Omit<TicketClaims, "iat" | "exp"> = {
  sub: "user-1",
  wid: "world-1",
  name: "Keeper",
  skinId: "default",
  role: "member",
  pv: 1
};

describe("join tickets", () => {
  test("round-trips claims through sign + verify", async () => {
    const ticket = await signTicket(claims, SECRET);
    const verified = await verifyTicket(ticket, SECRET);
    expect(verified).toMatchObject(claims);
    expect(verified!.exp - verified!.iat).toBe(TICKET_TTL_SECONDS);
  });

  test("rejects a ticket signed with a different secret", async () => {
    const ticket = await signTicket(claims, "some-other-secret");
    expect(await verifyTicket(ticket, SECRET)).toBeNull();
  });

  test("rejects tampered claims (payload swap keeps the old signature)", async () => {
    const ticket = await signTicket(claims, SECRET);
    const [header, , signature] = ticket.split(".");
    const forged = btoa(JSON.stringify({ ...claims, role: "owner", iat: 0, exp: 9999999999 }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(await verifyTicket(`${header}.${forged}.${signature}`, SECRET)).toBeNull();
  });

  test("expires after the TTL", async () => {
    const minted = Date.now();
    const ticket = await signTicket(claims, SECRET, minted);
    expect(await verifyTicket(ticket, SECRET, minted + (TICKET_TTL_SECONDS - 1) * 1000)).not.toBeNull();
    expect(await verifyTicket(ticket, SECRET, minted + (TICKET_TTL_SECONDS + 1) * 1000)).toBeNull();
  });

  test("is total on garbage", async () => {
    expect(await verifyTicket("", SECRET)).toBeNull();
    expect(await verifyTicket("a.b", SECRET)).toBeNull();
    expect(await verifyTicket("a.b.c", SECRET)).toBeNull();
    expect(await verifyTicket("🎫🎫🎫", SECRET)).toBeNull();
  });
});
