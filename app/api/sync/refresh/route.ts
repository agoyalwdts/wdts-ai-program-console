/**
 * Session-authenticated dashboard mirror refresh (manual or forced delta sync).
 */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { refreshDashboardMirrors, type SyncTier } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  force?: boolean;
  tiers?: SyncTier[];
};

export async function POST(request: Request): Promise<Response> {
  const user = await requireUser();

  let parsed: Body = {};
  try {
    const text = await request.text();
    if (text.trim()) parsed = JSON.parse(text) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const tiers = parsed.tiers ?? (["hot", "warm"] as SyncTier[]);

  try {
    const result = await refreshDashboardMirrors(prisma, {
      trigger: "manual_refresh",
      actorEmail: user.email,
      tiers,
      force: parsed.force === true,
      maxWaitMs: 60_000,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
