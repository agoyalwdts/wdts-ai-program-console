/**
 * POST /api/guardrail-policy-alerts/:id/request-seat-removal
 *
 * Appends a Decision (CURSOR_SEAT_RECLAIM or RECLAMATION) for operator
 * follow-up. Does not call vendor APIs.
 *
 * Body (optional): { "note": "string" }
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import {
  loadGuardrailAlertForAction,
  requestSeatRemovalFromAlert,
} from "@/lib/guardrails/alert-action-helpers";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const actor = await requirePermission(PERMISSIONS.GUARDRAILS_MONITOR);
  const { id } = await ctx.params;

  const alert = await loadGuardrailAlertForAction(prisma, id);
  if (!alert) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  let note: string | undefined;
  try {
    const body = (await req.json()) as { note?: string };
    note = body.note?.trim();
  } catch {
    /* empty body is fine */
  }

  const result = await requestSeatRemovalFromAlert({
    prisma,
    actorEmail: actor.email,
    alert,
    note,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    decisionId: result.decisionId,
    decisionType: result.decisionType,
  });
}
