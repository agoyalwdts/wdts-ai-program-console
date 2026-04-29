/**
 * POST /api/admin/users/[id]/disabled
 *
 * Body: { disabled: boolean }
 *
 * Disable / re-enable a user. ADMIN-only. Disabled users still pass
 * the proxy (their JWT is valid), but `requireRole`/`requirePermission`
 * redirect them to /?error=disabled.
 *
 * Owner protection:
 *   - Cannot disable the owner.
 *   - Cannot disable yourself.
 *
 * Writes a `Decision` row of type=USER_DISABLED / USER_ENABLED.
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const actor = await requirePermission(PERMISSIONS.USERS_MANAGE);
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }
  const disabled = (body as { disabled?: unknown }).disabled;
  if (typeof disabled !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "disabled (boolean) is required" },
      { status: 400 },
    );
  }

  const subject = await prisma.user.findUnique({ where: { id } });
  if (!subject) {
    return NextResponse.json(
      { ok: false, error: "user not found" },
      { status: 404 },
    );
  }

  if (disabled && subject.isOwner) {
    return NextResponse.json(
      { ok: false, error: "Cannot disable the dashboard owner." },
      { status: 409 },
    );
  }
  if (disabled && subject.email === actor.email) {
    return NextResponse.json(
      { ok: false, error: "You cannot disable yourself." },
      { status: 409 },
    );
  }

  if (subject.disabled === disabled) {
    return NextResponse.json({
      ok: true,
      noOp: true,
      message: `User already ${disabled ? "disabled" : "enabled"}.`,
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { disabled } });
    await tx.decision.create({
      data: {
        type: disabled ? "USER_DISABLED" : "USER_ENABLED",
        subjectUserId: id,
        beforeState: JSON.stringify({ disabled: subject.disabled }),
        afterState: JSON.stringify({ disabled }),
        actorEmail: actor.email,
        justification: disabled
          ? `Disabled user ${subject.email}`
          : `Re-enabled user ${subject.email}`,
      },
    });
  });

  return NextResponse.json({ ok: true, disabled });
}
