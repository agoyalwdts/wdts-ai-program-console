import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  await requirePermission(PERMISSIONS.GUARDRAILS_MONITOR);
  const { id } = await ctx.params;

  let body: { acknowledged?: boolean };
  try {
    body = (await req.json()) as { acknowledged?: boolean };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  if (body.acknowledged !== true) {
    return NextResponse.json(
      { ok: false, error: 'expected { "acknowledged": true }' },
      { status: 400 },
    );
  }

  const now = new Date();
  const res = await prisma.guardrailPolicyAlert.updateMany({
    where: { id, acknowledgedAt: null },
    data: { acknowledgedAt: now },
  });

  if (res.count === 0) {
    const exists = await prisma.guardrailPolicyAlert.findUnique({
      where: { id },
      select: { acknowledgedAt: true },
    });
    if (!exists) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    return NextResponse.json({
      ok: true,
      alreadyAcknowledged: true,
      acknowledgedAt: exists.acknowledgedAt?.toISOString() ?? null,
    });
  }

  return NextResponse.json({ ok: true, acknowledgedAt: now.toISOString() });
}
