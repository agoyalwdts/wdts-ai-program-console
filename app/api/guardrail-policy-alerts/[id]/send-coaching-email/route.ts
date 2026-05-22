/**
 * POST /api/guardrail-policy-alerts/:id/send-coaching-email
 *
 * Sends a one-off coaching email for this alert (any rule code). Requires
 * RESEND_API_KEY and a User row for the alert's email.
 */

import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import {
  loadGuardrailAlertForAction,
  sendAlertCoachingEmail,
} from "@/lib/guardrails/alert-action-helpers";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: RouteCtx) {
  await requirePermission(PERMISSIONS.GUARDRAILS_MONITOR);
  const { id } = await ctx.params;

  const alert = await loadGuardrailAlertForAction(prisma, id);
  if (!alert) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const result = await sendAlertCoachingEmail(prisma, alert);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  if (result.skipped) {
    return NextResponse.json({ ok: true, skipped: true, reason: result.reason });
  }

  return NextResponse.json({
    ok: true,
    userEmailNotifiedAt: new Date().toISOString(),
    resent: result.resent,
  });
}
