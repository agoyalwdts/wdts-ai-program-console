/**
 * FINOPS/ADMIN — trigger OpenAI organization costs sync for Program Health.
 *
 * POST JSON `{ "lookbackDays"?: number, "endOffsetDays"?: number, "skipDecision"?: boolean }`
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { executeSyncJob } from "@/lib/sync";
import { OPENAI_VENDOR_MANUAL_MAX_LOOKBACK_DAYS } from "@/lib/vendor-spend/sync-openai-vendor-daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  lookbackDays?: number;
  endOffsetDays?: number;
  skipDecision?: boolean;
};

export async function POST(request: Request): Promise<Response> {
  const actor = await requirePermission(PERMISSIONS.VENDOR_SPEND_SYNC);

  let parsed: Body = {};
  try {
    const t = await request.text();
    if (t.trim()) parsed = JSON.parse(t) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const lookbackDays = parsed.lookbackDays
    ? Math.min(Math.max(parsed.lookbackDays, 1), OPENAI_VENDOR_MANUAL_MAX_LOOKBACK_DAYS)
    : undefined;
  const endOffsetDays = Math.max(0, Math.floor(parsed.endOffsetDays ?? 0));

  try {
    const outcome = await executeSyncJob(prisma, "openai_org_costs", {
      trigger: "admin",
      actorEmail: actor.email,
      opts: {
        lookbackDays,
        endOffsetDays,
        skipDecision: parsed.skipDecision === true,
      },
      perJobTimeoutMs: 120_000,
    });
    if (!outcome.ok && !outcome.skipped) {
      return NextResponse.json({ ok: false, error: outcome.error }, { status: 502 });
    }
    return NextResponse.json(outcome);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
