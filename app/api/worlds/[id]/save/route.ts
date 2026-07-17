import { NextResponse } from "next/server";
import { db } from "@/db";
import { failureResponse, sessionUser, unauthorized } from "@/lib/online/http";
import { getSaveBlob, putSaveBlob } from "@/lib/online/worldsService";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/worlds/:id/save — the gzipped SaveData blob. The concurrency stamp
 * and save version ride response headers so the body stays raw bytes.
 *
 * `x-save-revision` is the sync cursor (which blob this is); `x-save-version`
 * is the save FORMAT version. Different things, adjacent names.
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
      "x-save-revision": String(result.saveRevision)
    }
  });
}

/** Stay inside the platform body limit. */
const MAX_SAVE_BLOB_BYTES = 4 * 1024 * 1024;

/**
 * PUT /api/worlds/:id/save — upload a new blob. `x-base-revision` must carry
 * the save revision the client last saw ("" for a first upload); a mismatch is
 * 409 and the client reconciles by fetching the newer save.
 */
export async function PUT(request: Request, { params }: Params) {
  const user = await sessionUser(request);
  if (!user) return unauthorized();
  const { id } = await params;
  const saveVersion = Number.parseInt(request.headers.get("x-save-version") ?? "", 10);
  const rawBase = request.headers.get("x-base-revision");
  // Absent/blank = first upload. A present-but-unparseable value is NOT quietly
  // treated as one — that would let a stale client clobber a real save — so it
  // stays NaN and putSaveBlob rejects it as invalid.
  const base = rawBase === null || rawBase === "" ? null : Number.parseInt(rawBase, 10);
  // Reject on the declared length first, so an oversized body is refused before
  // it is buffered into memory. A missing/lying header still hits the check
  // below — this is an early-out, not the enforcement.
  const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > MAX_SAVE_BLOB_BYTES) return failureResponse("invalid");
  const blob = new Uint8Array(await request.arrayBuffer());
  if (blob.byteLength > MAX_SAVE_BLOB_BYTES) return failureResponse("invalid");
  const result = await putSaveBlob(db(), user.id, id, blob, saveVersion, base);
  if (!result.ok) return failureResponse(result.error);
  return NextResponse.json({ saveRevision: result.saveRevision });
}
