/**
 * POST /api/cron/usage-mirror-health
 *
 * HMAC-protected cron (same contract as reconcile-azuread). Intended for
 * GitHub Actions / Logic Apps to detect a silent gateway mirror (no recent
 * successful webhook batches).
 *
 * Body JSON (optional):
 *   { "maxStaleMinutes": number, "requireBatch": boolean }
 *   - maxStaleMinutes defaults to 1440 (24h).
 *   - requireBatch defaults to false — set true to fail until the first
 *     USAGE_INGEST_BATCH row exists.
 *
 * Returns 200 + JSON when healthy, 503 when unhealthy (so uptime monitors
 * can alert on non-2xx).
 */

import { NextResponse } from "next/server";
import { verifyCronSignature } from "@/lib/cron/auth";
import { evaluateGatewayMirrorHealth } from "@/lib/gateway-mirror/mirror-health";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CronBody = {
  maxStaleMinutes?: number;
  requireBatch?: boolean;
};

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SHARED_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SHARED_SECRET is not configured." },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  const verification = verifyCronSignature({
    rawBody,
    signatureHeader: request.headers.get("x-cron-signature"),
    secret,
  });
  if (!verification.ok) {
    return NextResponse.json(
      { error: `signature verification failed: ${verification.reason}` },
      { status: 401 },
    );
  }

  let parsed: CronBody = {};
  if (rawBody.trim()) {
    try {
      parsed = JSON.parse(rawBody) as CronBody;
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }
  }

  const maxStaleMinutes =
    typeof parsed.maxStaleMinutes === "number" && Number.isFinite(parsed.maxStaleMinutes)
      ? Math.max(1, Math.min(parsed.maxStaleMinutes, 10_080))
      : 1440;
  const maxStaleMs = maxStaleMinutes * 60_000;
  const requireBatch = parsed.requireBatch === true;

  const result = await evaluateGatewayMirrorHealth(prisma, {
    maxStaleMs,
    requireBatch,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 503 });
  }

  return NextResponse.json(result);
}
