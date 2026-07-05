import { NextResponse } from "next/server";
import { db } from "@/db";
import { failureResponse, sessionUser, unauthorized } from "@/lib/online/http";
import { deleteWorld, getWorld, renameWorld } from "@/lib/online/worldsService";

type Params = { params: Promise<{ id: string }> };

/** GET /api/worlds/:id — one world (members only). */
export async function GET(request: Request, { params }: Params) {
  const user = await sessionUser(request);
  if (!user) return unauthorized();
  const { id } = await params;
  const result = await getWorld(db(), user.id, id);
  if (!result.ok) return failureResponse(result.error);
  return NextResponse.json({ world: result.world });
}

/** PATCH /api/worlds/:id — rename (owner only). */
export async function PATCH(request: Request, { params }: Params) {
  const user = await sessionUser(request);
  if (!user) return unauthorized();
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  const result = await renameWorld(db(), user.id, id, body?.name ?? "");
  if (!result.ok) return failureResponse(result.error);
  return NextResponse.json({ ok: true });
}

/** DELETE /api/worlds/:id — delete with cascading members/invites (owner only). */
export async function DELETE(request: Request, { params }: Params) {
  const user = await sessionUser(request);
  if (!user) return unauthorized();
  const { id } = await params;
  const result = await deleteWorld(db(), user.id, id);
  if (!result.ok) return failureResponse(result.error);
  return NextResponse.json({ ok: true });
}
