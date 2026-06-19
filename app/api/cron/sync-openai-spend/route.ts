/**
 * HMAC cron — pull OpenAI organization/costs and upsert VendorDailySpend (CHATGPT + CODEX).
 *
 * Body: optional `{ "lookbackDays": number, "endOffsetDays"?: number, "skipDecision"?: boolean }`
 * Default: delta from ledger (cap 31 days). Auth: x-cron-signature + CRON_SHARED_SECRET.
 */

import { NextResponse } from "next/server";
import { verifyCronSignature } from "@/lib/cron/auth";
import { prisma } from "@/lib/prisma";
import { executeSyncJob } from "@/lib/sync";
import { OPENAI_VENDOR_MANUAL_MAX_LOOKBACK_DAYS } from "@/lib/vendor-spend/sync-openai-vendor-daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  lookbackDays?: number;
  endOffsetDays?: number;
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
    ? Math.min(Math.max(parsed.lookbackDays, 1), OPENAI_VENDOR_MANUAL_MAX_LOOKBACK_DAYS)
    : undefined;
  const endOffsetDays = Math.max(0, Math.floor(parsed.endOffsetDays ?? 0));

  try {
    const outcome = await executeSyncJob(prisma, "openai_org_costs", {
      trigger: "cron",
      actorEmail: "cron-sync-openai-spend@dashboard",
      opts: {
        lookbackDays,
        endOffsetDays,
        skipDecision: parsed.skipDecision === true,
      },
      perJobTimeoutMs: 120_000,
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
