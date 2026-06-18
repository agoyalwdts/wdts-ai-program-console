import { NextResponse } from "next/server";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { requestCodexTierMove } from "@/lib/decisions/codex-tier-move";
import { prisma } from "@/lib/prisma";
import type { CodexSubTier } from "@/lib/integrations/openai";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  userId?: unknown;
  direction?: unknown;
  toSubTier?: unknown;
  justification?: unknown;
};

const VALID_TIERS = new Set<CodexSubTier>(["POWER", "STANDARD", "LIGHT", "DISCOVERY"]);

export async function POST(request: Request): Promise<Response> {
  const actor = await getCurrentUser();
  if (!actor) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (actor.disabled) {
    return NextResponse.json({ ok: false, error: "disabled" }, { status: 403 });
  }
  if (
    !userHasPermission(actor, PERMISSIONS.DECISIONS_APPROVE) ||
    !userHasPermission(actor, PERMISSIONS.POLICY_EDIT)
  ) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

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

  let toSubTier: CodexSubTier | undefined;
  if (body.toSubTier !== undefined && body.toSubTier !== null) {
    if (typeof body.toSubTier !== "string" || !VALID_TIERS.has(body.toSubTier as CodexSubTier)) {
      return NextResponse.json({ ok: false, error: "invalid toSubTier" }, { status: 400 });
    }
    toSubTier = body.toSubTier as CodexSubTier;
  }

  const justification =
    typeof body.justification === "string" ? body.justification : "";

  const result = await requestCodexTierMove({
    prisma,
    actorEmail: actor.email,
    userId: body.userId.trim(),
    direction,
    toSubTier,
    justification,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        decisionId: result.decisionId,
      },
      { status: result.status },
    );
  }

  return NextResponse.json(result);
}
