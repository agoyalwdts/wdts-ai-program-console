/**
 * HMAC cron — pull OpenAI organization/costs and upsert VendorDailySpend (CHATGPT + CODEX).
 *
 * Body: optional `{ "lookbackDays": number, "endOffsetDays"?: number, "skipDecision"?: boolean }`
 * Default: last 31 days (incremental). For backfill, GHA loops with endOffsetDays 0, 31, 62, …
 * Auth: same as /api/cron/reconcile-azuread (x-cron-signature + CRON_SHARED_SECRET).
 */

import { NextResponse } from "next/server";
import { verifyCronSignature } from "@/lib/cron/auth";
import { prisma } from "@/lib/prisma";
import {
  OPENAI_VENDOR_MANUAL_MAX_LOOKBACK_DAYS,
  syncOpenAiVendorDailySpendWindow,
} from "@/lib/vendor-spend/sync-openai-vendor-daily";

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

  const lookbackDays = Math.min(
    Math.max(parsed.lookbackDays ?? OPENAI_VENDOR_MANUAL_MAX_LOOKBACK_DAYS, 1),
    OPENAI_VENDOR_MANUAL_MAX_LOOKBACK_DAYS,
  );
  const endOffsetDays = Math.max(0, Math.floor(parsed.endOffsetDays ?? 0));

  try {
    const result = await syncOpenAiVendorDailySpendWindow(prisma, {
      lookbackDays,
      endOffsetDays,
      actorEmail: "cron-sync-openai-spend@dashboard",
      skipDecision: parsed.skipDecision === true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
