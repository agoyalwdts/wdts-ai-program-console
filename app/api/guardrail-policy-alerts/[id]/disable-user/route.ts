/**
 * POST /api/guardrail-policy-alerts/:id/disable-user
 *
 * Disables dashboard sign-in for the alert's userEmail. Does not revoke
 * Cursor or other vendor seats. Requires users.manage.
 */

import { NextRequest, NextResponse } from "next/server";
import { setUserDisabled } from "@/lib/admin/set-user-disabled";
import { requirePermission } from "@/lib/auth";
import {
  ensureGuardrailMirrorUser,
  loadGuardrailAlertForAction,
} from "@/lib/guardrails/alert-action-helpers";
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

  let note: string | undefined;
  let disabled = true;
  try {
    const body = (await req.json()) as { note?: string; disabled?: boolean };
    note = body.note?.trim();
    if (body.disabled === false) disabled = false;
  } catch {
    /* empty body is fine */
  }

  if (disabled) {
    const user = await ensureGuardrailMirrorUser(prisma, email);
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
      mirrorCreated: user.created,
    });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      disabled: true,
      isOwner: true,
      dashboardRoleId: true,
    },
  });

  if (!user) {
    return NextResponse.json(
      {
        ok: false,
        error: `No User row for ${email}. Invite them under Settings → Users first.`,
      },
      { status: 404 },
    );
  }

  if (!user.dashboardRoleId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `${email} was console-blocked without a dashboard invite. ` +
          `Use Settings → Users to invite them before allowing sign-in.`,
      },
      { status: 409 },
    );
  }

  const justification =
    `Re-enabled dashboard access from guardrail alert ${alert.id} (${alert.ruleCode}).` +
    (note ? ` ${note}` : "");

  const result = await setUserDisabled({
    prisma,
    actorEmail: actor.email,
    userId: user.id,
    disabled: false,
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
