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
import { setUserDisabled } from "@/lib/admin/set-user-disabled";
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

  const result = await setUserDisabled({
    prisma,
    actorEmail: actor.email,
    userId: id,
    disabled,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    disabled: result.disabled,
    noOp: result.noOp ?? false,
    message: result.message ?? null,
  });
}
