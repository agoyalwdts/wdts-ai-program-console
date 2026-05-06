/**
 * Shared DB + email side-effect path for Cursor usage prudence (CSV or API).
 */

import type { PrismaClient } from "@prisma/client";
import { DecisionType } from "@prisma/client";
import type { CursorUsageParsedRow } from "./types";
import { evaluatePrudence } from "./rules";
import { prudenceDedupeKey } from "./dedupe";
import { sendCursorPrudenceDigest } from "@/lib/notify/cursor-prudence-email";

export type PrudenceIngestCandidate = {
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

export function buildPrudenceCandidates(rows: CursorUsageParsedRow[]): PrudenceIngestCandidate[] {
  const candidates: PrudenceIngestCandidate[] = [];
  for (const row of rows) {
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
  return candidates;
}

export type PersistPrudenceIngestResult = {
  alertsInserted: number;
  candidatesEvaluated: number;
};

export async function persistCursorPrudenceIngest(args: {
  prisma: PrismaClient;
  candidates: PrudenceIngestCandidate[];
  rowsEvaluated: number;
  actorEmail: string;
  sourceFilename: string | null;
  justificationSummary: string;
  dashboardBaseUrl: string;
}): Promise<PersistPrudenceIngestResult> {
  const {
    prisma,
    candidates,
    rowsEvaluated,
    actorEmail,
    sourceFilename,
    justificationSummary,
    dashboardBaseUrl,
  } = args;

  if (candidates.length === 0) {
    await prisma.decision.create({
      data: {
        type: DecisionType.CURSOR_USAGE_PRUDENCE_INGEST,
        beforeState: JSON.stringify({ rows: rowsEvaluated }),
        afterState: JSON.stringify({ alertsInserted: 0 }),
        actorEmail,
        justification: `${justificationSummary} — no rows matched prudence rules`,
      },
    });
    return { alertsInserted: 0, candidatesEvaluated: 0 };
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
      dashboardBaseUrl,
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
      type: DecisionType.CURSOR_USAGE_PRUDENCE_INGEST,
      beforeState: JSON.stringify({
        rowsParsed: rowsEvaluated,
        filename: sourceFilename,
      }),
      afterState: JSON.stringify({
        alertsInserted: ins.count,
        candidatesEvaluated: candidates.length,
      }),
      actorEmail,
      justification: `${justificationSummary} · ${ins.count} new alert row(s) (${candidates.length} candidate(s))`,
    },
  });

  return { alertsInserted: ins.count, candidatesEvaluated: candidates.length };
}
