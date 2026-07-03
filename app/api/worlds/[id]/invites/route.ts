import { NextResponse } from "next/server";
import { db } from "@/db";
import { failureResponse, sessionUser, unauthorized } from "@/lib/online/http";
import { createInvite } from "@/lib/online/worldsService";

type Params = { params: Promise<{ id: string }> };

/** POST /api/worlds/:id/invites — mint an invite link token (owner only). */
export async function POST(request: Request, { params }: Params) {
  const user = await sessionUser(request);
  if (!user) return unauthorized();
  const { id } = await params;
  const result = await createInvite(db(), user.id, id);
  if (!result.ok) return failureResponse(result.error);
  return NextResponse.json({ token: result.token }, { status: 201 });
}
