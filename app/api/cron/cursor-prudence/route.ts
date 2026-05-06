/**
 * HMAC-protected cron: pull Cursor Admin filtered-usage-events for a lookback
 * window and materialise prudence alerts (same rules as CSV ingest).
 *
 * Body (optional JSON): { "lookbackDays": number } — default 7, max 30.
 * Requires CRON_SHARED_SECRET + x-cron-signature (see lib/cron/auth.ts).
 */

import { NextResponse } from "next/server";
import { verifyCronSignature } from "@/lib/cron/auth";
import { prisma } from "@/lib/prisma";
import { syncCursorPrudenceFromFilteredUsageApi } from "@/lib/cursor-usage/sync-filtered-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dashboardOrigin(): string {
  const u = process.env.NEXTAUTH_URL?.trim();
  if (u) return u.replace(/\/$/, "");
  const v = process.env.VERCEL_URL?.trim();
  if (v) return `https://${v.replace(/^https?:\/\//, "")}`;
  return "http://localhost:3000";
}

type CronBody = { lookbackDays?: number };

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
    return NextResponse.json({ error: verification.reason }, { status: 401 });
  }

  let lookbackDays = 7;
  if (rawBody.trim()) {
    try {
      const j = JSON.parse(rawBody) as CronBody;
      if (j && typeof j.lookbackDays === "number" && Number.isFinite(j.lookbackDays)) {
        lookbackDays = Math.floor(j.lookbackDays);
      }
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }
  }

  try {
    const out = await syncCursorPrudenceFromFilteredUsageApi({
      prisma,
      lookbackDays,
      dryRun: false,
      actorEmail: "cron:cursor-prudence",
      dashboardBaseUrl: dashboardOrigin(),
    });
    if (!out.ok) {
      return NextResponse.json({ ok: false, error: out.error }, { status: 503 });
    }
    return NextResponse.json({
      ok: true,
      eventsFetched: out.eventsFetched,
      rowsMapped: out.rowsMapped,
      alertsInserted: out.alertsInserted,
      candidatesEvaluated: out.candidatesEvaluated,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
