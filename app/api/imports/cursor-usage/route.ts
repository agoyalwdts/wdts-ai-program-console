/**
 * POST /api/imports/cursor-usage
 *   multipart/form-data `file` or text/csv body — Cursor team-usage CSV.
 *
 * Evaluates each row with heuristics in lib/cursor-usage; inserts
 * CursorUsagePrudenceAlert rows (deduped). Optional Resend email when
 * RESEND_API_KEY + CURSOR_ALERT_EMAIL_TO are set.
 *
 * Auth: requirePermission(imports.cursor_usage) — FINOPS + ADMIN by default.
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseCursorUsageCsv, buildPrudenceCandidates } from "@/lib/cursor-usage";
import { persistCursorPrudenceIngest } from "@/lib/cursor-usage/persist-prudence-ingest";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 12 * 1024 * 1024;

function dashboardOrigin(): string {
  const u = process.env.NEXTAUTH_URL?.trim();
  if (u) return u.replace(/\/$/, "");
  const v = process.env.VERCEL_URL?.trim();
  if (v) return `https://${v.replace(/^https?:\/\//, "")}`;
  return "http://localhost:3000";
}

export async function POST(req: NextRequest) {
  const user = await requirePermission(PERMISSIONS.IMPORTS_CURSOR_USAGE);

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  let csvText: string;
  let sourceFilename: string | null = null;
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json(
          { ok: false, error: "missing 'file' field in multipart upload" },
          { status: 400 },
        );
      }
      sourceFilename = file.name || null;
      if (file.size > MAX_BYTES) {
        return NextResponse.json(
          { ok: false, error: `file exceeds ${MAX_BYTES} byte ceiling` },
          { status: 413 },
        );
      }
      csvText = await file.text();
    } else if (contentType.includes("text/csv") || contentType.includes("text/plain")) {
      const buf = await req.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) {
        return NextResponse.json(
          { ok: false, error: `body exceeds ${MAX_BYTES} byte ceiling` },
          { status: 413 },
        );
      }
      csvText = new TextDecoder("utf-8").decode(buf);
    } else {
      return NextResponse.json(
        {
          ok: false,
          error:
            "unsupported content-type. Use multipart/form-data with a 'file' field, or text/csv",
        },
        { status: 415 },
      );
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `failed to read upload: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  const parsed = parseCursorUsageCsv(csvText);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  if (parsed.rows.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "no parsable data rows",
        rowsSkipped: parsed.rowsSkipped,
        parseErrors: parsed.parseErrors,
      },
      { status: 400 },
    );
  }

  const candidates = buildPrudenceCandidates(parsed.rows);

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      rowsParsed: parsed.rows.length,
      rowsSkipped: parsed.rowsSkipped,
      parseErrors: parsed.parseErrors,
      alertsWouldCreate: candidates.length,
      sample: candidates.slice(0, 15).map((c) => ({
        userEmail: c.userEmail,
        model: c.model,
        costUsd: c.costUsd,
        ruleCode: c.ruleCode,
        title: c.title,
      })),
    });
  }

  const persisted = await persistCursorPrudenceIngest({
    prisma,
    candidates,
    rowsEvaluated: parsed.rows.length,
    actorEmail: user.email,
    sourceFilename,
    justificationSummary: `Cursor team-usage prudence CSV${sourceFilename ? `: ${sourceFilename}` : ""}`,
    dashboardBaseUrl: dashboardOrigin(),
  });

  return NextResponse.json({
    ok: true,
    dryRun: false,
    rowsParsed: parsed.rows.length,
    rowsSkipped: parsed.rowsSkipped,
    parseErrors: parsed.parseErrors,
    alertsInserted: persisted.alertsInserted,
    candidatesEvaluated: persisted.candidatesEvaluated,
  });
}
