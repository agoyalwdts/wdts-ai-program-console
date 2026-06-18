import { NextResponse } from "next/server";
import type { Product, ReclamationTrigger } from "@prisma/client";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { createReclamationEvent } from "@/lib/reclamation/reclamation-events";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  userId?: unknown;
  product?: unknown;
  trigger?: unknown;
  justification?: unknown;
};

const VALID_PRODUCTS = new Set<Product>(["CURSOR", "CODEX", "CHATGPT", "CLAUDE_AI", "M365_COPILOT"]);
const VALID_TRIGGERS = new Set<ReclamationTrigger>([
  "IDLE",
  "CAP_BREACH",
  "TIER_DEMOTION",
  "HRIS_LEAVE",
  "MANUAL",
]);

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
  if (typeof body.product !== "string" || !VALID_PRODUCTS.has(body.product as Product)) {
    return NextResponse.json({ ok: false, error: "invalid product" }, { status: 400 });
  }
  const trigger =
    typeof body.trigger === "string" && VALID_TRIGGERS.has(body.trigger as ReclamationTrigger)
      ? (body.trigger as ReclamationTrigger)
      : "MANUAL";
  const justification = typeof body.justification === "string" ? body.justification : "";

  const result = await createReclamationEvent({
    prisma,
    actorEmail: auth.email,
    userId: body.userId.trim(),
    product: body.product as Product,
    trigger,
    justification,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, event: result.event });
}
