import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/server";

/**
 * The better-auth mount: sign-in/up (email/password), session, sign-out —
 * everything under /api/auth/* is handled by the library.
 * Constructed lazily per process: building the app must not require
 * DATABASE_URL (next build imports every route module to collect page data).
 */
let handler: ReturnType<typeof toNextJsHandler> | null = null;
const mount = () => (handler ??= toNextJsHandler(auth()));

export async function GET(request: Request): Promise<Response> {
  return mount().GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return mount().POST(request);
}
