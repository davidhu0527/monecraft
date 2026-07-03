import { NextResponse } from "next/server";
import { db } from "@/db";
import { failureResponse, sessionUser, unauthorized } from "@/lib/online/http";
import { createWorld, listWorlds, type CreateWorldInput } from "@/lib/online/worldsService";

/** GET /api/worlds — every world the signed-in user may play. */
export async function GET(request: Request) {
  const user = await sessionUser(request);
  if (!user) return unauthorized();
  return NextResponse.json({ worlds: await listWorlds(db(), user.id) });
}

/** POST /api/worlds — create a world (sp-cloud or mp); the creator becomes owner. */
export async function POST(request: Request) {
  const user = await sessionUser(request);
  if (!user) return unauthorized();
  const body = (await request.json().catch(() => null)) as CreateWorldInput | null;
  if (!body) return failureResponse("invalid");
  const result = await createWorld(db(), user.id, body);
  if (!result.ok) return failureResponse(result.error);
  return NextResponse.json({ world: result.world }, { status: 201 });
}
