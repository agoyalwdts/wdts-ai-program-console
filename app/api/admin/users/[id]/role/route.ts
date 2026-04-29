/**
 * POST /api/admin/users/[id]/role
 *
 * Body: { roleKey: string }
 *
 * Change a user's dashboard role. ADMIN-only. Owner protection:
 *   - Cannot demote the owner (their role is always ADMIN).
 *   - Cannot demote yourself below ADMIN (lockout protection).
 *   - Cannot assign a role that doesn't exist.
 *
 * Writes a `Decision` row of type=ROLE_CHANGE.
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
  const roleKey = (body as { roleKey?: unknown }).roleKey;
  if (typeof roleKey !== "string" || !roleKey) {
    return NextResponse.json(
      { ok: false, error: "roleKey is required" },
      { status: 400 },
    );
  }

  const subject = await prisma.user.findUnique({
    where: { id },
    include: { dashboardRole: true },
  });
  if (!subject) {
    return NextResponse.json(
      { ok: false, error: "user not found" },
      { status: 404 },
    );
  }

  // Owner protection.
  if (subject.isOwner && roleKey !== "ADMIN") {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Cannot demote the dashboard owner. Transfer ownership first via /settings/users.",
      },
      { status: 409 },
    );
  }
  // Self-demote protection.
  if (subject.email === actor.email && roleKey !== "ADMIN") {
    return NextResponse.json(
      {
        ok: false,
        error:
          "You cannot demote yourself below ADMIN. Ask another admin to do it.",
      },
      { status: 409 },
    );
  }

  const newRole = await prisma.role.findUnique({ where: { key: roleKey } });
  if (!newRole) {
    return NextResponse.json(
      { ok: false, error: `role "${roleKey}" not found` },
      { status: 404 },
    );
  }

  if (subject.dashboardRole?.key === newRole.key) {
    // No-op; respond OK without writing a decision row.
    return NextResponse.json({
      ok: true,
      noOp: true,
      message: `User already has role ${newRole.key}.`,
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id },
      data: { dashboardRoleId: newRole.id },
      include: { dashboardRole: true },
    });
    await tx.decision.create({
      data: {
        type: "ROLE_CHANGE",
        subjectUserId: id,
        beforeState: JSON.stringify({
          roleKey: subject.dashboardRole?.key ?? null,
        }),
        afterState: JSON.stringify({ roleKey: newRole.key }),
        actorEmail: actor.email,
        justification: `Role changed: ${subject.dashboardRole?.key ?? "(none)"} → ${newRole.key}`,
      },
    });
    return u;
  });

  return NextResponse.json({
    ok: true,
    user: {
      id: updated.id,
      email: updated.email,
      roleKey: updated.dashboardRole?.key ?? null,
    },
  });
}
