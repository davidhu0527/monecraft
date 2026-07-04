import { NextResponse } from "next/server";
import { db } from "@/db";
import { failureResponse, sessionUser, unauthorized } from "@/lib/online/http";
import { mintTicket } from "@/lib/online/worldsService";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/worlds/:id/ticket — mint the 60-second join ticket the game
 * server admits sockets with. The only endpoint that touches the shared
 * GAME_TICKET_SECRET; the game server itself never sees a cookie.
 */
export async function POST(request: Request, { params }: Params) {
  const user = await sessionUser(request);
  if (!user) return unauthorized();
  const secret = process.env.GAME_TICKET_SECRET;
  if (!secret) return NextResponse.json({ error: "server-misconfigured" }, { status: 500 });
  const { id } = await params;
  // The client names which profile is joining, so the ticket (and thus the
  // roster others see) carries the profile's name + skin, not the account's.
  const body = (await request.json().catch(() => null)) as { profileId?: string } | null;
  const result = await mintTicket(db(), user, id, secret, body?.profileId ?? null);
  if (!result.ok) return failureResponse(result.error);
  return NextResponse.json({ ticket: result.ticket, gameServerUrl: process.env.NEXT_PUBLIC_GAME_SERVER_URL ?? null });
}
