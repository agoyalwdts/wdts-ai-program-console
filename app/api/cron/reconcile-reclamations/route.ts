/**
 * Cron handler — expire NOTIFIED reclamation events whose dispute window
 * has elapsed (§4.6.4). Opens policy-repo PR + Decision for each reclaim.
 */

import { NextResponse } from "next/server";
import { verifyCronSignature } from "@/lib/cron/auth";
import { prisma } from "@/lib/prisma";
import { processExpiredReclamationDisputeWindows } from "@/lib/reclamation/reclamation-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CronBody = { dryRun?: boolean };

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

  const summary = await processExpiredReclamationDisputeWindows({
    prisma,
    dryRun: Boolean(parsed.dryRun),
  });

  return NextResponse.json({ ok: true, dryRun: Boolean(parsed.dryRun), summary });
}

export async function GET(): Promise<Response> {
  return NextResponse.json(
    {
      error: "method not allowed",
      hint: "POST with HMAC-signed body. See lib/cron/auth.ts.",
    },
    { status: 405 },
  );
}
