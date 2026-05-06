/**
 * POST /api/imports/cursor-prudence-api
 *   Pulls granular usage from Cursor Admin POST /teams/filtered-usage-events
 *   and runs the same prudence rules as CSV upload.
 *
 * Query: dryRun=1 — preview only.
 * Body (optional JSON): { "lookbackDays": number } — default 7, max 30.
 *
 * Auth: requirePermission(imports.cursor_usage).
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncCursorPrudenceFromFilteredUsageApi } from "@/lib/cursor-usage/sync-filtered-api";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function dashboardOrigin(): string {
  const u = process.env.NEXTAUTH_URL?.trim();
  if (u) return u.replace(/\/$/, "");
  const v = process.env.VERCEL_URL?.trim();
  if (v) return `https://${v.replace(/^https?:\/\//, "")}`;
  return "http://localhost:3000";
}

type Body = { lookbackDays?: number };

export async function POST(req: NextRequest) {
  const user = await requirePermission(PERMISSIONS.IMPORTS_CURSOR_USAGE);
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";

  let lookbackDays = 7;
  const raw = await req.text();
  if (raw.trim()) {
    try {
      const j = JSON.parse(raw) as Body;
      if (j && typeof j.lookbackDays === "number" && Number.isFinite(j.lookbackDays)) {
        lookbackDays = Math.floor(j.lookbackDays);
      }
    } catch {
      return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
    }
  }

  try {
    const out = await syncCursorPrudenceFromFilteredUsageApi({
      prisma,
      lookbackDays,
      dryRun,
      actorEmail: user.email,
      dashboardBaseUrl: dashboardOrigin(),
    });
    if (!out.ok) {
      return NextResponse.json({ ok: false, error: out.error }, { status: 400 });
    }
    if (out.dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        eventsFetched: out.eventsFetched,
        rowsMapped: out.rowsMapped,
        alertsWouldCreate: out.alertsWouldCreate,
        sample: out.sample?.map((c) => ({
          userEmail: c.userEmail,
          model: c.model,
          costUsd: c.costUsd,
          ruleCode: c.ruleCode,
          title: c.title,
        })),
      });
    }
    return NextResponse.json({
      ok: true,
      dryRun: false,
      eventsFetched: out.eventsFetched,
      rowsMapped: out.rowsMapped,
      alertsInserted: out.alertsInserted,
      candidatesEvaluated: out.candidatesEvaluated,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
