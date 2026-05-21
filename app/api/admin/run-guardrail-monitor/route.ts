/**
 * GUARDRAILS_MONITOR — run the same scan as POST /api/cron/guardrail-monitor
 * (session auth instead of HMAC).
 *
 * POST JSON `{ "windowHours"?: number }` — default 2, max 168.
 */

import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { runGuardrailMonitor } from "@/lib/guardrails/monitor";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { windowHours?: number };

export async function POST(request: Request): Promise<Response> {
  const actor = await requirePermission(PERMISSIONS.GUARDRAILS_MONITOR);

  let parsed: Body = {};
  try {
    const t = await request.text();
    if (t.trim()) parsed = JSON.parse(t) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const windowHours =
    typeof parsed.windowHours === "number" && Number.isFinite(parsed.windowHours)
      ? Math.max(1, Math.min(Math.floor(parsed.windowHours), 168))
      : 2;

  try {
    const summary = await runGuardrailMonitor(prisma, {
      windowHours,
      actorEmail: actor.email,
    });
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
