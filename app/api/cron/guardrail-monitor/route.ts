import { NextResponse } from "next/server";
import { verifyCronSignature } from "@/lib/cron/auth";
import { prisma } from "@/lib/prisma";
import { runGuardrailMonitor } from "@/lib/guardrails/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CronBody = { windowHours?: number };

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

  const summary = await runGuardrailMonitor(prisma, {
    windowHours:
      typeof parsed.windowHours === "number" && Number.isFinite(parsed.windowHours)
        ? parsed.windowHours
        : 2,
  });

  return NextResponse.json({ ok: true, summary });
}
