/**
 * HMAC cron — poll Workspace Analytics API (Compliance Logs) for all four event types.
 *
 * Body: optional `{ "initialLookbackDays": number }` (default 7, max 90).
 * Requires INTEGRATION_OPENAI_COMPLIANCE=real and OPENAI_COMPLIANCE_API_KEY.
 */

import { NextResponse } from "next/server";
import { verifyCronSignature } from "@/lib/cron/auth";
import { syncWorkspaceAnalytics } from "@/lib/integrations/workspace-analytics";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { initialLookbackDays?: number };

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

  let parsed: Body = {};
  if (rawBody.trim()) {
    try {
      parsed = JSON.parse(rawBody) as Body;
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }
  }

  try {
    const result = await syncWorkspaceAnalytics(prisma, {
      actorEmail: "cron-sync-workspace-analytics@dashboard",
      initialLookbackDays: parsed.initialLookbackDays,
    });
    if (!result.ok) {
      return NextResponse.json(result, { status: 503 });
    }
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
