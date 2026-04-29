/**
 * POST /api/admin/roles
 *
 * Body: { key: string, displayName: string, description?: string,
 *         permissions: string[] }
 *
 * Create a custom role. ADMIN-only. Built-in role keys are protected:
 * the seed owns USER/MANAGER/FINOPS/ADMIN, so a POST that uses one of
 * those keys returns 409.
 *
 * Permission keys are validated against the catalogue; unknown keys
 * are rejected so a typo doesn't ship a "permission" the code never
 * checks.
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS, isValidPermissionKey } from "@/lib/rbac/permissions";
import { isBuiltInRoleKey } from "@/lib/rbac/built-in-roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CreateBody = {
  key?: unknown;
  displayName?: unknown;
  description?: unknown;
  permissions?: unknown;
};

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{1,40}$/;

export async function POST(req: NextRequest) {
  const actor = await requirePermission(PERMISSIONS.ROLES_MANAGE);

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }

  const { key, displayName, description, permissions } = body;
  if (typeof key !== "string" || !SLUG_RE.test(key)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'key must be a kebab/snake-case slug, 2-41 chars (e.g. "auditor", "cursor_lead")',
      },
      { status: 400 },
    );
  }
  if (isBuiltInRoleKey(key.toUpperCase())) {
    return NextResponse.json(
      {
        ok: false,
        error: `"${key}" collides with a built-in role. Pick a different slug.`,
      },
      { status: 409 },
    );
  }
  if (typeof displayName !== "string" || !displayName.trim()) {
    return NextResponse.json(
      { ok: false, error: "displayName is required" },
      { status: 400 },
    );
  }
  if (description != null && typeof description !== "string") {
    return NextResponse.json(
      { ok: false, error: "description must be a string if provided" },
      { status: 400 },
    );
  }
  if (
    !Array.isArray(permissions) ||
    !permissions.every((p) => typeof p === "string")
  ) {
    return NextResponse.json(
      { ok: false, error: "permissions must be an array of strings" },
      { status: 400 },
    );
  }
  const unknown = (permissions as string[]).filter(
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

  const dupe = await prisma.role.findUnique({ where: { key } });
  if (dupe) {
    return NextResponse.json(
      { ok: false, error: `role with key "${key}" already exists` },
      { status: 409 },
    );
  }

  const role = await prisma.$transaction(async (tx) => {
    const r = await tx.role.create({
      data: {
        key,
        displayName: displayName.trim(),
        description:
          typeof description === "string" ? description.trim() : null,
        isBuiltIn: false,
        permissions: permissions as string[],
      },
    });
    await tx.decision.create({
      data: {
        type: "ROLE_CREATED",
        beforeState: JSON.stringify({ key: null }),
        afterState: JSON.stringify({
          key: r.key,
          permissions: r.permissions,
        }),
        actorEmail: actor.email,
        justification: `Created custom role "${r.displayName}" (${r.key}) with ${r.permissions.length} permissions`,
      },
    });
    return r;
  });

  return NextResponse.json({ ok: true, role }, { status: 201 });
}
