import { NextResponse } from "next/server";
import { db } from "@/db";
import { failureResponse, sessionUser, unauthorized } from "@/lib/online/http";
import { getSaveBlob, putSaveBlob } from "@/lib/online/worldsService";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/worlds/:id/save — the gzipped SaveData blob. The concurrency stamp
 * and save version ride response headers so the body stays raw bytes.
 */
export async function GET(request: Request, { params }: Params) {
  const user = await sessionUser(request);
  if (!user) return unauthorized();
  const { id } = await params;
  const result = await getSaveBlob(db(), user.id, id);
  if (!result.ok) return failureResponse(result.error);
  if (!result.blob) return NextResponse.json({ error: "no-save" }, { status: 404 });
  return new NextResponse(Buffer.from(result.blob), {
    headers: {
      "content-type": "application/gzip",
      "x-save-version": String(result.saveVersion ?? ""),
      "x-updated-at": result.updatedAt
    }
  });
}

/**
 * PUT /api/worlds/:id/save — upload a new blob. `x-base-updated-at` must
 * carry the stamp the client last saw ("" for a first upload); a mismatch is
 * 409 and the client reconciles by fetching the newer save.
 */
export async function PUT(request: Request, { params }: Params) {
  const user = await sessionUser(request);
  if (!user) return unauthorized();
  const { id } = await params;
  const saveVersion = Number.parseInt(request.headers.get("x-save-version") ?? "", 10);
  const base = request.headers.get("x-base-updated-at") || null;
  const blob = new Uint8Array(await request.arrayBuffer());
  if (blob.byteLength > 4 * 1024 * 1024) return failureResponse("invalid"); // stay inside the platform body limit
  const result = await putSaveBlob(db(), user.id, id, blob, saveVersion, base);
  if (!result.ok) return failureResponse(result.error);
  return NextResponse.json({ updatedAt: result.updatedAt });
}
