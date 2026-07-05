import { NextResponse } from "next/server";
import { db } from "@/db";
import { failureResponse, sessionUser, unauthorized } from "@/lib/online/http";
import { deleteProfile, updateProfile } from "@/lib/online/worldsService";

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/profiles/:id — rename and/or reskin a profile (owner only). */
export async function PATCH(request: Request, { params }: Params) {
  const user = await sessionUser(request);
  if (!user) return unauthorized();
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { name?: string; skinId?: string | null } | null;
  if (!body) return failureResponse("invalid");
  const result = await updateProfile(db(), user.id, id, body);
  if (!result.ok) return failureResponse(result.error);
  return NextResponse.json({ ok: true });
}

/** DELETE /api/profiles/:id — delete a profile and (cascading) its online worlds (owner only). */
export async function DELETE(request: Request, { params }: Params) {
  const user = await sessionUser(request);
  if (!user) return unauthorized();
  const { id } = await params;
  const result = await deleteProfile(db(), user.id, id);
  if (!result.ok) return failureResponse(result.error);
  return NextResponse.json({ ok: true });
}
