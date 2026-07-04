import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";

/**
 * Shared plumbing for the online API routes: cookie-session extraction and
 * the mapping from worldsService's typed failures to HTTP status codes. The
 * routes stay one-screen adapters; the rules live (tested) in worldsService.
 */

export type SessionUser = { id: string; name: string; skinId: string | null };

/** The signed-in user, or null (routes answer 401). */
export async function sessionUser(request: Request): Promise<SessionUser | null> {
  const session = await auth().api.getSession({ headers: request.headers as Headers });
  if (!session?.user) return null;
  const user = session.user as { id: string; name: string; skinId?: string | null };
  return { id: user.id, name: user.name, skinId: user.skinId ?? null };
}

export const unauthorized = (): NextResponse => NextResponse.json({ error: "unauthorized" }, { status: 401 });

const STATUS: Record<string, number> = {
  "not-found": 404,
  forbidden: 403,
  conflict: 409,
  invalid: 400,
  expired: 410
};

export function failureResponse(error: string): NextResponse {
  return NextResponse.json({ error }, { status: STATUS[error] ?? 500 });
}
