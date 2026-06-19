/**
 * HMAC cron — poll Workspace Analytics API (Compliance Logs) for all four event types.
 *
 * Body: optional `{ "initialLookbackDays": number }` (default: delta / 7).
 * Requires INTEGRATION_OPENAI_COMPLIANCE=real and OPENAI_COMPLIANCE_API_KEY.
 */

import { NextResponse } from "next/server";
import { verifyCronSignature } from "@/lib/cron/auth";
import { prisma } from "@/lib/prisma";
import { executeSyncJob } from "@/lib/sync";

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
    const outcome = await executeSyncJob(prisma, "workspace_analytics", {
      trigger: "cron",
      actorEmail: "cron-sync-workspace-analytics@dashboard",
      opts: parsed.initialLookbackDays
        ? { initialLookbackDays: parsed.initialLookbackDays }
        : undefined,
      perJobTimeoutMs: 120_000,
    });
    if (!outcome.ok && !outcome.skipped) {
      return NextResponse.json({ ok: false, error: outcome.error }, { status: 503 });
    }
    return NextResponse.json(outcome);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
