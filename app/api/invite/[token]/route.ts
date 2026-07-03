import { NextResponse } from "next/server";
import { db } from "@/db";
import { failureResponse, sessionUser, unauthorized } from "@/lib/online/http";
import { acceptInvite, resolveInvite } from "@/lib/online/worldsService";

type Params = { params: Promise<{ token: string }> };

/** GET /api/invite/:token — what does this invite open? (No auth: the join page shows the world name before sign-in.) */
export async function GET(_request: Request, { params }: Params) {
  const { token } = await params;
  const result = await resolveInvite(db(), token);
  if (!result.ok) return failureResponse(result.error);
  return NextResponse.json({ worldId: result.worldId, worldName: result.worldName });
}

/** POST /api/invite/:token — join the world (idempotent for existing members). */
export async function POST(request: Request, { params }: Params) {
  const user = await sessionUser(request);
  if (!user) return unauthorized();
  const { token } = await params;
  const result = await acceptInvite(db(), user.id, token);
  if (!result.ok) return failureResponse(result.error);
  return NextResponse.json({ worldId: result.worldId });
}
