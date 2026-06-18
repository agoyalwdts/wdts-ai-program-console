import { NextResponse } from "next/server";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { disputeReclamationEvent } from "@/lib/reclamation/reclamation-events";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { disputeReason?: unknown };

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await getCurrentUser();
  if (!actor) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (actor.disabled) {
    return NextResponse.json({ ok: false, error: "disabled" }, { status: 403 });
  }

  const { id } = await ctx.params;
  let body: Body = {};
  try {
    const t = await request.text();
    if (t.trim()) body = JSON.parse(t) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const disputeReason = typeof body.disputeReason === "string" ? body.disputeReason : "";
  const result = await disputeReclamationEvent({
    prisma,
    eventId: id,
    actorEmail: actor.email,
    disputeReason,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, event: result.event });
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
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

  const { id } = await ctx.params;
  let body: { outcome?: unknown; note?: unknown } = {};
  try {
    body = (await request.json()) as { outcome?: unknown; note?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const outcome = body.outcome === "retain" || body.outcome === "reclaim" ? body.outcome : null;
  if (!outcome) {
    return NextResponse.json(
      { ok: false, error: 'outcome must be "retain" or "reclaim"' },
      { status: 400 },
    );
  }

  const note = typeof body.note === "string" ? body.note : undefined;
  const { resolveReclamationEvent } = await import("@/lib/reclamation/reclamation-events");
  const result = await resolveReclamationEvent({
    prisma,
    eventId: id,
    actorEmail: actor.email,
    outcome,
    note,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, decisionId: result.decisionId },
      { status: result.status },
    );
  }

  return NextResponse.json({ ok: true, event: result.event });
}
