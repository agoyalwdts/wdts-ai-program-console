/**
 * HMAC cron — pull Cursor Team Admin usage events and upsert VendorDailySpend.
 *
 * Body: optional `{ "lookbackDays": number }` (default 120, max 400).
 * Auth: same as /api/cron/reconcile-azuread (x-cron-signature + CRON_SHARED_SECRET).
 */

import { NextResponse } from "next/server";
import { verifyCronSignature } from "@/lib/cron/auth";
import { prisma } from "@/lib/prisma";
import { syncCursorVendorDailySpend } from "@/lib/vendor-spend/sync-cursor-vendor-daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { lookbackDays?: number };

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

  const lookbackDays = parsed.lookbackDays ?? 120;

  try {
    const result = await syncCursorVendorDailySpend(prisma, {
      lookbackDays,
      actorEmail: "cron-sync-cursor-spend@dashboard",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
