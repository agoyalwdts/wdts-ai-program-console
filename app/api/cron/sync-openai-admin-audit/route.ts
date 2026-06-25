/**
 * HMAC cron — pull OpenAI organization audit_logs → snapshot + Decision ledger.
 *
 * Body: optional `{ "lookbackDays": number, "skipDecision"?: boolean }`
 * Auth: x-cron-signature + CRON_SHARED_SECRET.
 */

import { NextResponse } from "next/server";
import { verifyCronSignature } from "@/lib/cron/auth";
import { prisma } from "@/lib/prisma";
import { executeSyncJob } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  lookbackDays?: number;
  skipDecision?: boolean;
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

  let parsed: Body = {};
  if (rawBody.trim()) {
    try {
      parsed = JSON.parse(rawBody) as Body;
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }
  }

  const lookbackDays = parsed.lookbackDays
    ? Math.min(Math.max(parsed.lookbackDays, 1), 31)
    : undefined;

  try {
    const outcome = await executeSyncJob(prisma, "openai_admin_audit", {
      trigger: "cron",
      actorEmail: "cron-sync-openai-admin-audit@dashboard",
      opts: {
        lookbackDays,
        skipDecision: parsed.skipDecision === true,
      },
      perJobTimeoutMs: 90_000,
    });
    if (!outcome.ok && !outcome.skipped) {
      return NextResponse.json({ ok: false, error: outcome.error }, { status: 502 });
    }
    return NextResponse.json(outcome);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
