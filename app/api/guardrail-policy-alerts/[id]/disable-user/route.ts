/**
 * POST /api/guardrail-policy-alerts/:id/disable-user
 *
 * Disables dashboard sign-in for the alert's userEmail. Does not revoke
 * Cursor or other vendor seats. Requires users.manage.
 */

import { NextRequest, NextResponse } from "next/server";
import { setUserDisabled } from "@/lib/admin/set-user-disabled";
import { requirePermission } from "@/lib/auth";
import { loadGuardrailAlertForAction, findUserIdByEmail } from "@/lib/guardrails/alert-action-helpers";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const actor = await requirePermission(PERMISSIONS.USERS_MANAGE);
  const { id } = await ctx.params;

  const alert = await loadGuardrailAlertForAction(prisma, id);
  if (!alert) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const email = alert.userEmail?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ ok: false, error: "Alert has no user email." }, { status: 400 });
  }

  const user = await findUserIdByEmail(prisma, email);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: `No User row for ${email}. Invite them under Settings → Users first.` },
      { status: 404 },
    );
  }

  let note: string | undefined;
  try {
    const body = (await req.json()) as { note?: string };
    note = body.note?.trim();
  } catch {
    /* empty body is fine */
  }

  const justification =
    `Disabled dashboard access from guardrail alert ${alert.id} (${alert.ruleCode}).` +
    (note ? ` ${note}` : "");

  const result = await setUserDisabled({
    prisma,
    actorEmail: actor.email,
    userId: user.id,
    disabled: true,
    justification,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    disabled: result.disabled,
    noOp: result.noOp ?? false,
    message: result.message ?? null,
    userId: user.id,
  });
}
