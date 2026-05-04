/**
 * GET /api/health
 *
 * Public liveness probe (listed in `auth.ts` PUBLIC_PATHS) for load balancers,
 * Playwright, and curl smoke tests — no session required.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return NextResponse.json({
    ok: true,
    service: "wdts-ai-program-console",
  });
}
