import { DecisionType, Product } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { calendarDayAtNoonFromYmd, eachYmdInclusive, inclusiveDayCountYmd } from "./dates";
import { parseChatgptUsersCsv } from "./parse-chatgpt-users-csv";
import { parseCodexWorkspaceJson } from "./parse-codex-workspace-json";
import { parseCodexSessionsJson } from "./parse-codex-sessions-json";
import { parseCodexCodeReviewJson } from "./parse-codex-code-review-json";
import { parseCursorTeamCsv } from "./parse-cursor-team-csv";
import { parseGenericChatgptAdminCsv } from "./parse-generic-chatgpt-csv";
import {
  MANUAL_CHATGPT_USERS_CSV_VENDOR_KEY,
  MANUAL_CODEX_ADMIN_EXPORT_VENDOR_KEY,
} from "./vendor-keys";
import type { ProgramVendorExportKind } from "./kinds";
import { OPENAI_CREDIT_OVERAGE_USD } from "@/lib/program";

export type ProgramVendorExportBundle = {
  chatgptUsers?: { filename: string; text: string };
  chatgptGpts?: { filename: string; text: string };
  chatgptProjects?: { filename: string; text: string };
  chatgptImpactSurvey?: { filename: string; text: string };
  codexWorkspaceUsage?: { filename: string; text: string };
  codexSessionsMessages?: { filename: string; text: string };
  codexCodeReview?: { filename: string; text: string };
  cursorAnalyticsTeam?: { filename: string; text: string };
};

export type ApplyProgramVendorExportResult = {
  snapshots: number;
  chatgptVendorDays: number;
  codexVendorDays: number;
  kinds: ProgramVendorExportKind[];
  errors: string[];
};

function rangeBounds(ymdStart: string, ymdEnd: string): { gte: Date; lte: Date } {
  return {
    gte: calendarDayAtNoonFromYmd(ymdStart),
    lte: calendarDayAtNoonFromYmd(ymdEnd),
  };
}

export async function applyProgramVendorExportBundle(
  prisma: PrismaClient,
  actorEmail: string,
  bundle: ProgramVendorExportBundle,
): Promise<ApplyProgramVendorExportResult> {
  const errors: string[] = [];
  const kinds: ProgramVendorExportKind[] = [];
  let snapshots = 0;
  let chatgptVendorDays = 0;
  let codexVendorDays = 0;
  let wroteCodexSpendFromWorkspace = false;

  await prisma.$transaction(async (tx) => {
    if (bundle.chatgptUsers) {
      try {
        const parsed = parseChatgptUsersCsv(bundle.chatgptUsers.text);
        const nDays = inclusiveDayCountYmd(parsed.periodStart, parsed.periodEnd);
        const perDayUsd = (parsed.totalCredits / nDays) * OPENAI_CREDIT_OVERAGE_USD;
        const { gte, lte } = rangeBounds(parsed.periodStart, parsed.periodEnd);

        await tx.vendorDailySpend.deleteMany({
          where: {
            vendor: MANUAL_CHATGPT_USERS_CSV_VENDOR_KEY,
            product: Product.CHATGPT,
            day: { gte, lte },
          },
        });

        const spendRows = [...eachYmdInclusive(parsed.periodStart, parsed.periodEnd)].map(
          (ymd) => ({
            vendor: MANUAL_CHATGPT_USERS_CSV_VENDOR_KEY,
            product: Product.CHATGPT,
            day: calendarDayAtNoonFromYmd(ymd),
            spendUsd: perDayUsd,
            eventCount: 0,
          }),
        );
        await tx.vendorDailySpend.createMany({ data: spendRows });
        chatgptVendorDays = spendRows.length;

        await tx.programVendorExportSnapshot.create({
          data: {
            kind: "CHATGPT_USERS_CSV",
            filename: bundle.chatgptUsers.filename,
            periodStart: calendarDayAtNoonFromYmd(parsed.periodStart),
            periodEnd: calendarDayAtNoonFromYmd(parsed.periodEnd),
            rowCount: parsed.rows.length,
            actorEmail,
            payload: {
              periodStart: parsed.periodStart,
              periodEnd: parsed.periodEnd,
              totalCredits: parsed.totalCredits,
              totalMessages: parsed.totalMessages,
              userCount: parsed.rows.length,
              users: parsed.rows,
              note:
                "credits_used from export are spread evenly across export period days for Program Health (no daily breakdown in source file).",
            },
          },
        });
        snapshots++;
        kinds.push("CHATGPT_USERS_CSV");
      } catch (e) {
        errors.push(`chatgptUsers: ${(e as Error).message}`);
      }
    }

    if (bundle.codexWorkspaceUsage) {
      try {
        const parsed = parseCodexWorkspaceJson(bundle.codexWorkspaceUsage.text);
        const first = parsed.days[0]?.date;
        const last = parsed.days[parsed.days.length - 1]?.date;
        if (!first || !last) throw new Error("no dates");

        const { gte, lte } = rangeBounds(first, last);
        await tx.vendorDailySpend.deleteMany({
          where: {
            vendor: MANUAL_CODEX_ADMIN_EXPORT_VENDOR_KEY,
            product: Product.CODEX,
            day: { gte, lte },
          },
        });

        const spendRows = parsed.days.map((d) => ({
          vendor: MANUAL_CODEX_ADMIN_EXPORT_VENDOR_KEY,
          product: Product.CODEX,
          day: calendarDayAtNoonFromYmd(d.date),
          spendUsd: d.credits * OPENAI_CREDIT_OVERAGE_USD,
          eventCount: d.turns,
        }));
        await tx.vendorDailySpend.createMany({ data: spendRows });
        codexVendorDays = spendRows.length;
        wroteCodexSpendFromWorkspace = true;

        await tx.programVendorExportSnapshot.create({
          data: {
            kind: "CODEX_WORKSPACE_JSON",
            filename: bundle.codexWorkspaceUsage.filename,
            periodStart: calendarDayAtNoonFromYmd(first),
            periodEnd: calendarDayAtNoonFromYmd(last),
            rowCount: parsed.days.length,
            actorEmail,
            payload: { days: parsed.days },
          },
        });
        snapshots++;
        kinds.push("CODEX_WORKSPACE_JSON");
      } catch (e) {
        errors.push(`codexWorkspaceUsage: ${(e as Error).message}`);
      }
    }

    if (bundle.codexSessionsMessages) {
      try {
        const parsed = parseCodexSessionsJson(bundle.codexSessionsMessages.text);
        const dates = Object.keys(parsed.creditsByDate).sort();
        const first = dates[0];
        const last = dates[dates.length - 1];
        if (!first || !last) throw new Error("no dates");

        if (!wroteCodexSpendFromWorkspace) {
          const { gte, lte } = rangeBounds(first, last);
          await tx.vendorDailySpend.deleteMany({
            where: {
              vendor: MANUAL_CODEX_ADMIN_EXPORT_VENDOR_KEY,
              product: Product.CODEX,
              day: { gte, lte },
            },
          });
          const spendRows = dates.map((ymd) => ({
            vendor: MANUAL_CODEX_ADMIN_EXPORT_VENDOR_KEY,
            product: Product.CODEX,
            day: calendarDayAtNoonFromYmd(ymd),
            spendUsd: (parsed.creditsByDate[ymd] ?? 0) * OPENAI_CREDIT_OVERAGE_USD,
            eventCount: 0,
          }));
          await tx.vendorDailySpend.createMany({ data: spendRows });
          codexVendorDays = spendRows.length;
        }

        await tx.programVendorExportSnapshot.create({
          data: {
            kind: "CODEX_SESSIONS_JSON",
            filename: bundle.codexSessionsMessages.filename,
            periodStart: calendarDayAtNoonFromYmd(first),
            periodEnd: calendarDayAtNoonFromYmd(last),
            rowCount: parsed.rowCount,
            actorEmail,
            payload: {
              creditsByDate: parsed.creditsByDate,
              userCount: parsed.userCount,
              usedForVendorSpend: !wroteCodexSpendFromWorkspace,
            },
          },
        });
        snapshots++;
        kinds.push("CODEX_SESSIONS_JSON");
      } catch (e) {
        errors.push(`codexSessionsMessages: ${(e as Error).message}`);
      }
    }

    if (bundle.codexCodeReview) {
      try {
        const parsed = parseCodexCodeReviewJson(bundle.codexCodeReview.text);
        const first = parsed.days[0]?.date;
        const last = parsed.days[parsed.days.length - 1]?.date;
        if (!first || !last) throw new Error("no dates");
        await tx.programVendorExportSnapshot.create({
          data: {
            kind: "CODEX_CODE_REVIEW_JSON",
            filename: bundle.codexCodeReview.filename,
            periodStart: calendarDayAtNoonFromYmd(first),
            periodEnd: calendarDayAtNoonFromYmd(last),
            rowCount: parsed.days.length,
            actorEmail,
            payload: { days: parsed.days },
          },
        });
        snapshots++;
        kinds.push("CODEX_CODE_REVIEW_JSON");
      } catch (e) {
        errors.push(`codexCodeReview: ${(e as Error).message}`);
      }
    }

    if (bundle.chatgptGpts) {
      try {
        const parsed = parseGenericChatgptAdminCsv(bundle.chatgptGpts.text);
        await tx.programVendorExportSnapshot.create({
          data: {
            kind: "CHATGPT_GPTS_CSV",
            filename: bundle.chatgptGpts.filename,
            periodStart: parsed.periodStart
              ? calendarDayAtNoonFromYmd(parsed.periodStart)
              : null,
            periodEnd: parsed.periodEnd ? calendarDayAtNoonFromYmd(parsed.periodEnd) : null,
            rowCount: parsed.rows.length,
            actorEmail,
            payload: { headers: parsed.headers, rows: parsed.rows },
          },
        });
        snapshots++;
        kinds.push("CHATGPT_GPTS_CSV");
      } catch (e) {
        errors.push(`chatgptGpts: ${(e as Error).message}`);
      }
    }

    if (bundle.chatgptProjects) {
      try {
        const parsed = parseGenericChatgptAdminCsv(bundle.chatgptProjects.text);
        await tx.programVendorExportSnapshot.create({
          data: {
            kind: "CHATGPT_PROJECTS_CSV",
            filename: bundle.chatgptProjects.filename,
            periodStart: parsed.periodStart
              ? calendarDayAtNoonFromYmd(parsed.periodStart)
              : null,
            periodEnd: parsed.periodEnd ? calendarDayAtNoonFromYmd(parsed.periodEnd) : null,
            rowCount: parsed.rows.length,
            actorEmail,
            payload: { headers: parsed.headers, rows: parsed.rows },
          },
        });
        snapshots++;
        kinds.push("CHATGPT_PROJECTS_CSV");
      } catch (e) {
        errors.push(`chatgptProjects: ${(e as Error).message}`);
      }
    }

    if (bundle.chatgptImpactSurvey) {
      try {
        const parsed = parseGenericChatgptAdminCsv(bundle.chatgptImpactSurvey.text);
        await tx.programVendorExportSnapshot.create({
          data: {
            kind: "CHATGPT_IMPACT_SURVEY_CSV",
            filename: bundle.chatgptImpactSurvey.filename,
            periodStart: null,
            periodEnd: null,
            rowCount: parsed.rows.length,
            actorEmail,
            payload: { headers: parsed.headers, rows: parsed.rows },
          },
        });
        snapshots++;
        kinds.push("CHATGPT_IMPACT_SURVEY_CSV");
      } catch (e) {
        errors.push(`chatgptImpactSurvey: ${(e as Error).message}`);
      }
    }

    if (bundle.cursorAnalyticsTeam) {
      try {
        const parsed = parseCursorTeamCsv(bundle.cursorAnalyticsTeam.text);
        const dates = parsed.rows
          .map((r) => (r[parsed.dateColumn] ?? "").trim())
          .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
        const sorted = [...dates].sort();
        const first = sorted[0];
        const last = sorted[sorted.length - 1];

        await tx.programVendorExportSnapshot.create({
          data: {
            kind: "CURSOR_ANALYTICS_TEAM_CSV",
            filename: bundle.cursorAnalyticsTeam.filename,
            periodStart: first ? calendarDayAtNoonFromYmd(first) : null,
            periodEnd: last ? calendarDayAtNoonFromYmd(last) : null,
            rowCount: parsed.rows.length,
            actorEmail,
            payload: {
              dateColumn: parsed.dateColumn,
              headers: parsed.headers,
              rows: parsed.rows,
            },
          },
        });
        snapshots++;
        kinds.push("CURSOR_ANALYTICS_TEAM_CSV");
      } catch (e) {
        errors.push(`cursorAnalyticsTeam: ${(e as Error).message}`);
      }
    }

    if (snapshots > 0) {
      await tx.decision.create({
        data: {
          type: DecisionType.PROGRAM_VENDOR_EXPORT_IMPORT,
          beforeState: "{}",
          afterState: JSON.stringify({
            kinds,
            snapshots,
            chatgptVendorDays,
            codexVendorDays,
            errors,
          }),
          actorEmail,
          justification: `Program vendor export bundle (${kinds.join(", ")})`,
        },
      });
    }
  });

  return { snapshots, chatgptVendorDays, codexVendorDays, kinds, errors };
}
