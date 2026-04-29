/**
 * PATCH  /api/admin/roles/[id] — edit a role
 * DELETE /api/admin/roles/[id] — delete a custom role
 *
 * ADMIN-only. Built-in roles:
 *   - displayName + description are editable.
 *   - permissions are NOT editable here (the seed owns those, re-synced
 *     from `lib/rbac/built-in-roles.ts` on every deploy). PATCH that
 *     attempts to change permissions on a built-in returns 409.
 *   - DELETE always returns 409 for built-ins.
 *
 * Custom roles:
 *   - Full CRUD on displayName, description, permissions.
 *   - DELETE returns 409 if any user is currently assigned. Reassign
 *     first (no automatic reassignment to USER — that would be a
 *     surprise; admin should make the choice deliberately).
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS, isValidPermissionKey } from "@/lib/rbac/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

type PatchBody = {
  displayName?: unknown;
  description?: unknown;
  permissions?: unknown;
};

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const actor = await requirePermission(PERMISSIONS.ROLES_MANAGE);
  const { id } = await ctx.params;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }

  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) {
    return NextResponse.json(
      { ok: false, error: "role not found" },
      { status: 404 },
    );
  }

  const update: {
    displayName?: string;
    description?: string | null;
    permissions?: string[];
  } = {};

  if (body.displayName != null) {
    if (typeof body.displayName !== "string" || !body.displayName.trim()) {
      return NextResponse.json(
        { ok: false, error: "displayName must be a non-empty string" },
        { status: 400 },
      );
    }
    update.displayName = body.displayName.trim();
  }

  if (body.description !== undefined) {
    if (body.description != null && typeof body.description !== "string") {
      return NextResponse.json(
        { ok: false, error: "description must be a string or null" },
        { status: 400 },
      );
    }
    update.description =
      typeof body.description === "string" ? body.description.trim() : null;
  }

  if (body.permissions !== undefined) {
    if (role.isBuiltIn) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Built-in role permissions are managed in code (lib/rbac/built-in-roles.ts) and cannot be edited via the API.",
        },
        { status: 409 },
      );
    }
    if (
      !Array.isArray(body.permissions) ||
      !body.permissions.every((p) => typeof p === "string")
    ) {
      return NextResponse.json(
        { ok: false, error: "permissions must be an array of strings" },
        { status: 400 },
      );
    }
    const unknown = (body.permissions as string[]).filter(
      (p) => !isValidPermissionKey(p),
    );
    if (unknown.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `unknown permission key(s): ${unknown.join(", ")}`,
        },
        { status: 400 },
      );
    }
    update.permissions = body.permissions as string[];
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { ok: false, error: "no recognised fields to update" },
      { status: 400 },
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.role.update({ where: { id }, data: update });
    await tx.decision.create({
      data: {
        type: "ROLE_EDITED",
        beforeState: JSON.stringify({
          displayName: role.displayName,
          description: role.description,
          permissions: role.permissions,
        }),
        afterState: JSON.stringify({
          displayName: r.displayName,
          description: r.description,
          permissions: r.permissions,
        }),
        actorEmail: actor.email,
        justification: `Edited role "${r.key}" (${Object.keys(update).join(", ")})`,
      },
    });
    return r;
  });

  return NextResponse.json({ ok: true, role: updated });
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const actor = await requirePermission(PERMISSIONS.ROLES_MANAGE);
  const { id } = await ctx.params;

  const role = await prisma.role.findUnique({
    where: { id },
    include: { _count: { select: { users: true } } },
  });
  if (!role) {
    return NextResponse.json(
      { ok: false, error: "role not found" },
      { status: 404 },
    );
  }

  if (role.isBuiltIn) {
    return NextResponse.json(
      { ok: false, error: "Built-in roles cannot be deleted." },
      { status: 409 },
    );
  }

  if (role._count.users > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `Cannot delete: ${role._count.users} user(s) currently have this role. Reassign them via /settings/users, then retry.`,
      },
      { status: 409 },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.role.delete({ where: { id } });
    await tx.decision.create({
      data: {
        type: "ROLE_DELETED",
        beforeState: JSON.stringify({
          key: role.key,
          permissions: role.permissions,
        }),
        afterState: JSON.stringify({ key: null }),
        actorEmail: actor.email,
        justification: `Deleted custom role "${role.displayName}" (${role.key})`,
      },
    });
  });

  return NextResponse.json({ ok: true });
}
