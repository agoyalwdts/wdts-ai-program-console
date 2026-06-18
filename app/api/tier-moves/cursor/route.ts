import { NextResponse } from "next/server";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { requestCursorTierMove } from "@/lib/decisions/cursor-tier-move";
import { prisma } from "@/lib/prisma";
import type { CursorSubTier } from "@/lib/integrations/cursor/types";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  userId?: unknown;
  direction?: unknown;
  toSubTier?: unknown;
  justification?: unknown;
};

const VALID_TIERS = new Set<CursorSubTier>(["POWER", "STANDARD", "LIGHT", "DISCOVERY"]);

async function requirePolicyWriter(): Promise<
  { ok: true; email: string } | { ok: false; response: Response }
> {
  const actor = await getCurrentUser();
  if (!actor) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }),
    };
  }
  if (actor.disabled) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "disabled" }, { status: 403 }),
    };
  }
  if (
    !userHasPermission(actor, PERMISSIONS.DECISIONS_APPROVE) ||
    !userHasPermission(actor, PERMISSIONS.POLICY_EDIT)
  ) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, email: actor.email };
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requirePolicyWriter();
  if (!auth.ok) return auth.response;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof body.userId !== "string" || !body.userId.trim()) {
    return NextResponse.json({ ok: false, error: "userId is required" }, { status: 400 });
  }

  const direction =
    body.direction === "promote" || body.direction === "demote" ? body.direction : null;
  if (!direction) {
    return NextResponse.json(
      { ok: false, error: 'direction must be "promote" or "demote"' },
      { status: 400 },
    );
  }

  let toSubTier: CursorSubTier | undefined;
  if (body.toSubTier !== undefined && body.toSubTier !== null) {
    if (typeof body.toSubTier !== "string" || !VALID_TIERS.has(body.toSubTier as CursorSubTier)) {
      return NextResponse.json({ ok: false, error: "invalid toSubTier" }, { status: 400 });
    }
    toSubTier = body.toSubTier as CursorSubTier;
  }

  const justification = typeof body.justification === "string" ? body.justification : "";

  const result = await requestCursorTierMove({
    prisma,
    actorEmail: auth.email,
    userId: body.userId.trim(),
    direction,
    toSubTier,
    justification,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, decisionId: result.decisionId },
      { status: result.status },
    );
  }

  return NextResponse.json(result);
}
