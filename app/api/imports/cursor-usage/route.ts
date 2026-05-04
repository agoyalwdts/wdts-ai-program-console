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
import {
  parseCursorUsageCsv,
  evaluatePrudence,
  prudenceDedupeKey,
} from "@/lib/cursor-usage";
import { sendCursorPrudenceDigest } from "@/lib/notify/cursor-prudence-email";
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

  type Candidate = {
    rowOccurredAt: Date;
    userEmail: string;
    model: string;
    maxMode: string;
    inputCacheWrite: number;
    inputNoCache: number;
    cacheRead: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    ruleCode: string;
    title: string;
    rationale: string;
    dedupeKey: string;
  };

  const candidates: Candidate[] = [];
  for (const row of parsed.rows) {
    const ev = evaluatePrudence(row);
    if (!ev) continue;
    candidates.push({
      rowOccurredAt: row.occurredAt,
      userEmail: row.userEmail,
      model: row.model,
      maxMode: row.maxMode ? "Yes" : "No",
      inputCacheWrite: row.inputCacheWrite,
      inputNoCache: row.inputNoCache,
      cacheRead: row.cacheRead,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      costUsd: row.costUsd,
      ruleCode: ev.ruleCode,
      title: ev.title,
      rationale: ev.rationale,
      dedupeKey: prudenceDedupeKey(row, ev.ruleCode),
    });
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      rowsParsed: parsed.rows.length,
      rowsSkipped: parsed.rowsSkipped,
      parseErrors: parsed.parseErrors,
      alertsWouldCreate: candidates.length,
      sample: candidates.slice(0, 15),
    });
  }

  if (candidates.length === 0) {
    await prisma.decision.create({
      data: {
        type: "CURSOR_USAGE_PRUDENCE_INGEST",
        beforeState: JSON.stringify({ rows: parsed.rows.length }),
        afterState: JSON.stringify({ alertsInserted: 0 }),
        actorEmail: user.email,
        justification: `Cursor usage CSV${sourceFilename ? `: ${sourceFilename}` : ""} — no rows matched prudence rules`,
      },
    });
    return NextResponse.json({
      ok: true,
      dryRun: false,
      rowsParsed: parsed.rows.length,
      rowsSkipped: parsed.rowsSkipped,
      parseErrors: parsed.parseErrors,
      alertsInserted: 0,
    });
  }

  const jobStart = new Date();
  const data = candidates.map((c) => ({
    rowOccurredAt: c.rowOccurredAt,
    userEmail: c.userEmail,
    model: c.model,
    maxMode: c.maxMode,
    inputCacheWrite: c.inputCacheWrite,
    inputNoCache: c.inputNoCache,
    cacheRead: c.cacheRead,
    outputTokens: c.outputTokens,
    totalTokens: c.totalTokens,
    costUsd: c.costUsd,
    ruleCode: c.ruleCode,
    title: c.title,
    rationale: c.rationale,
    dedupeKey: c.dedupeKey,
    sourceFilename,
  }));

  const ins = await prisma.cursorUsagePrudenceAlert.createMany({
    data,
    skipDuplicates: true,
  });

  const dedupeKeys = [...new Set(candidates.map((c) => c.dedupeKey))];
  const fresh = await prisma.cursorUsagePrudenceAlert.findMany({
    where: {
      dedupeKey: { in: dedupeKeys },
      createdAt: { gte: jobStart },
      emailNotifiedAt: null,
    },
    select: {
      id: true,
      userEmail: true,
      model: true,
      costUsd: true,
      ruleCode: true,
      title: true,
    },
  });

  if (fresh.length > 0) {
    const mail = await sendCursorPrudenceDigest({
      dashboardBaseUrl: dashboardOrigin(),
      subject: `[WDTS AI Console] ${fresh.length} Cursor usage prudence alert(s)`,
      lines: fresh.map((a) => ({
        userEmail: a.userEmail,
        model: a.model,
        costUsd: a.costUsd,
        ruleCode: a.ruleCode,
        title: a.title,
      })),
    });
    if (mail.ok && !mail.skipped) {
      await prisma.cursorUsagePrudenceAlert.updateMany({
        where: { id: { in: fresh.map((f) => f.id) } },
        data: { emailNotifiedAt: new Date() },
      });
    }
  }

  await prisma.decision.create({
    data: {
      type: "CURSOR_USAGE_PRUDENCE_INGEST",
      beforeState: JSON.stringify({
        rowsParsed: parsed.rows.length,
        filename: sourceFilename,
      }),
      afterState: JSON.stringify({
        alertsInserted: ins.count,
        candidatesEvaluated: candidates.length,
      }),
      actorEmail: user.email,
      justification: `Cursor team-usage prudence ingest${sourceFilename ? `: ${sourceFilename}` : ""} · ${ins.count} new alert row(s) (${candidates.length} candidate(s))`,
    },
  });

  return NextResponse.json({
    ok: true,
    dryRun: false,
    rowsParsed: parsed.rows.length,
    rowsSkipped: parsed.rowsSkipped,
    parseErrors: parsed.parseErrors,
    alertsInserted: ins.count,
    candidatesEvaluated: candidates.length,
  });
}
