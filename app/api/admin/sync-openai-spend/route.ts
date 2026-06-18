/**
 * FINOPS/ADMIN — trigger OpenAI organization costs sync for Program Health.
 *
 * POST JSON `{ "lookbackDays"?: number, "endOffsetDays"?: number, "skipDecision"?: boolean }`
 *
 * For historical backfill, call repeatedly with endOffsetDays 0, 31, 62, … (see
 * openAiVendorBackfillChunks) — one window per request avoids App Service timeouts.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  OPENAI_VENDOR_MANUAL_MAX_LOOKBACK_DAYS,
  syncOpenAiVendorDailySpendWindow,
} from "@/lib/vendor-spend/sync-openai-vendor-daily";

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

  const lookbackDays = Math.min(
    Math.max(parsed.lookbackDays ?? OPENAI_VENDOR_MANUAL_MAX_LOOKBACK_DAYS, 1),
    OPENAI_VENDOR_MANUAL_MAX_LOOKBACK_DAYS,
  );
  const endOffsetDays = Math.max(0, Math.floor(parsed.endOffsetDays ?? 0));

  try {
    const result = await syncOpenAiVendorDailySpendWindow(prisma, {
      lookbackDays,
      endOffsetDays,
      actorEmail: actor.email,
      skipDecision: parsed.skipDecision === true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
