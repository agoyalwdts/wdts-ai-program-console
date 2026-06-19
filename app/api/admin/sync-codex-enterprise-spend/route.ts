/**
 * FINOPS/ADMIN — trigger Codex Enterprise Analytics sync for Program Health (CODEX tile).
 *
 * POST JSON `{ "lookbackDays"?: number }`
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { executeSyncJob } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { lookbackDays?: number };

export async function POST(request: Request): Promise<Response> {
  const actor = await requirePermission(PERMISSIONS.VENDOR_SPEND_SYNC);

  let parsed: Body = {};
  try {
    const t = await request.text();
    if (t.trim()) parsed = JSON.parse(t) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const outcome = await executeSyncJob(prisma, "codex_enterprise_spend", {
      trigger: "admin",
      actorEmail: actor.email,
      opts: parsed.lookbackDays ? { lookbackDays: parsed.lookbackDays } : { lookbackDays: 120 },
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
