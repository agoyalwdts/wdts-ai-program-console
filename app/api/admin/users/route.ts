/**
 * POST /api/admin/users
 *
 * Body: { email: string, displayName?: string, roleKey?: string,
 *         title?: string }
 *
 * Invite a user. ADMIN-only. Creates a User row with the chosen role
 * (default USER) and `disabled=false`. The user appears immediately on
 * /settings/users; on their first sign-in via Microsoft Entra, the
 * existing row is found, the access gate lets them through, and their
 * displayName is refreshed from the IdP profile if it still equals
 * the email placeholder.
 *
 * Closed-by-default model (LDR 0005): without a User row, sign-in is
 * rejected at the OAuth callback. So this is the *only* way a new
 * person gets dashboard access (other than the bootstrap-owner rule).
 *
 * Writes a `Decision` row of type=USER_INVITED.
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CreateBody = {
  email?: unknown;
  displayName?: unknown;
  roleKey?: unknown;
  title?: unknown;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const actor = await requirePermission(PERMISSIONS.USERS_MANAGE);

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }

  const rawEmail = body.email;
  if (typeof rawEmail !== "string" || !EMAIL_RE.test(rawEmail.trim())) {
    return NextResponse.json(
      { ok: false, error: "email is required and must be a valid address" },
      { status: 400 },
    );
  }
  const email = rawEmail.trim().toLowerCase();

  if (
    body.displayName !== undefined &&
    body.displayName !== null &&
    typeof body.displayName !== "string"
  ) {
    return NextResponse.json(
      { ok: false, error: "displayName must be a string if provided" },
      { status: 400 },
    );
  }
  if (
    body.title !== undefined &&
    body.title !== null &&
    typeof body.title !== "string"
  ) {
    return NextResponse.json(
      { ok: false, error: "title must be a string if provided" },
      { status: 400 },
    );
  }

  const wantedRoleKey =
    typeof body.roleKey === "string" && body.roleKey.trim()
      ? body.roleKey.trim()
      : "USER";

  const role = await prisma.role.findUnique({ where: { key: wantedRoleKey } });
  if (!role) {
    return NextResponse.json(
      { ok: false, error: `role "${wantedRoleKey}" not found` },
      { status: 404 },
    );
  }

  const dupe = await prisma.user.findUnique({ where: { email } });
  if (dupe) {
    return NextResponse.json(
      {
        ok: false,
        error: `User ${email} already exists. Edit their role on /settings/users instead.`,
      },
      { status: 409 },
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email,
        // Until the user actually signs in we only have the email.
        // The auth.ts JIT logic refreshes this from the IdP profile
        // on first sign-in (one-shot, only if it still equals email).
        displayName:
          (typeof body.displayName === "string" && body.displayName.trim()) ||
          email,
        title:
          (typeof body.title === "string" && body.title.trim()) || null,
        roleTag: "UNKNOWN",
        region: "UNKNOWN",
        status: "ACTIVE",
        disabled: false,
        isOwner: false,
        dashboardRoleId: role.id,
      },
      include: { dashboardRole: { select: { key: true } } },
    });
    await tx.decision.create({
      data: {
        type: "USER_INVITED",
        subjectUserId: u.id,
        beforeState: JSON.stringify({ email: null }),
        afterState: JSON.stringify({
          email: u.email,
          roleKey: role.key,
        }),
        actorEmail: actor.email,
        justification: `Invited ${u.email} as ${role.key}`,
      },
    });
    return u;
  });

  return NextResponse.json(
    {
      ok: true,
      user: {
        id: created.id,
        email: created.email,
        displayName: created.displayName,
        roleKey: created.dashboardRole?.key ?? role.key,
      },
    },
    { status: 201 },
  );
}
