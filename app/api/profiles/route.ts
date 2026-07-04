import { NextResponse } from "next/server";
import { db } from "@/db";
import { failureResponse, sessionUser, unauthorized } from "@/lib/online/http";
import { createProfile, listProfiles } from "@/lib/online/worldsService";

/** GET /api/profiles — the signed-in account's online profiles. */
export async function GET(request: Request) {
  const user = await sessionUser(request);
  if (!user) return unauthorized();
  return NextResponse.json({ profiles: await listProfiles(db(), user.id) });
}

/** POST /api/profiles — create an account profile (guests can't; capped per account). */
export async function POST(request: Request) {
  const user = await sessionUser(request);
  if (!user) return unauthorized();
  const body = (await request.json().catch(() => null)) as { name?: string; skinId?: string | null } | null;
  if (!body) return failureResponse("invalid");
  const result = await createProfile(db(), { id: user.id, isAnonymous: user.isAnonymous }, { name: body.name ?? "", skinId: body.skinId ?? null });
  if (!result.ok) return failureResponse(result.error);
  return NextResponse.json({ profile: result.profile }, { status: 201 });
}
