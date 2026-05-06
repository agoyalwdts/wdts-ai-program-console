/**
 * POST /api/imports/program-vendor-exports
 *   multipart/form-data — optional file fields (see ImportProgramVendorPanel).
 *
 * ?dryRun=1 parses files only; no DB writes.
 *
 * Auth: ADMIN | FINOPS (Server Functions are outside the proxy auth chain).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { applyProgramVendorExportBundle } from "@/lib/imports/program-vendor-export/apply-program-vendor-export";
import type { ProgramVendorExportBundle } from "@/lib/imports/program-vendor-export/apply-program-vendor-export";
import { parseChatgptUsersCsv } from "@/lib/imports/program-vendor-export/parse-chatgpt-users-csv";
import { parseCodexWorkspaceJson } from "@/lib/imports/program-vendor-export/parse-codex-workspace-json";
import { parseCodexSessionsJson } from "@/lib/imports/program-vendor-export/parse-codex-sessions-json";
import { parseCodexCodeReviewJson } from "@/lib/imports/program-vendor-export/parse-codex-code-review-json";
import { parseCursorTeamCsv } from "@/lib/imports/program-vendor-export/parse-cursor-team-csv";
import { parseGenericChatgptAdminCsv } from "@/lib/imports/program-vendor-export/parse-generic-chatgpt-csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES_PER_FILE = 35 * 1024 * 1024;

type FieldName =
  | "chatgptUsers"
  | "chatgptGpts"
  | "chatgptProjects"
  | "chatgptImpactSurvey"
  | "codexWorkspaceUsage"
  | "codexSessionsMessages"
  | "codexCodeReview"
  | "cursorAnalyticsTeam";

async function readBundleFromForm(form: FormData): Promise<{
  bundle: ProgramVendorExportBundle;
  readErrors: string[];
}> {
  const bundle: ProgramVendorExportBundle = {};
  const readErrors: string[] = [];

  async function take(name: FieldName) {
    const file = form.get(name);
    if (!(file instanceof File) || file.size === 0) return;
    if (file.size > MAX_BYTES_PER_FILE) {
      readErrors.push(`${name}: exceeds ${MAX_BYTES_PER_FILE} bytes`);
      return;
    }
    const text = await file.text();
    (bundle as Record<string, { filename: string; text: string }>)[name] = {
      filename: file.name,
      text,
    };
  }

  await take("chatgptUsers");
  await take("chatgptGpts");
  await take("chatgptProjects");
  await take("chatgptImpactSurvey");
  await take("codexWorkspaceUsage");
  await take("codexSessionsMessages");
  await take("codexCodeReview");
  await take("cursorAnalyticsTeam");

  return { bundle, readErrors };
}

function dryRunParse(bundle: ProgramVendorExportBundle): { ok: boolean; notes: string[] } {
  const notes: string[] = [];
  try {
    if (bundle.chatgptUsers) {
      const p = parseChatgptUsersCsv(bundle.chatgptUsers.text);
      notes.push(
        `chatgptUsers: ${p.rows.length} users, credits ${p.totalCredits.toFixed(2)}, ${p.periodStart}→${p.periodEnd}`,
      );
    }
    if (bundle.codexWorkspaceUsage) {
      const p = parseCodexWorkspaceJson(bundle.codexWorkspaceUsage.text);
      notes.push(`codexWorkspaceUsage: ${p.days.length} days`);
    }
    if (bundle.codexSessionsMessages) {
      const p = parseCodexSessionsJson(bundle.codexSessionsMessages.text);
      notes.push(
        `codexSessionsMessages: ${p.rowCount} rows, ${Object.keys(p.creditsByDate).length} days, ${p.userCount} users`,
      );
    }
    if (bundle.codexCodeReview) {
      const p = parseCodexCodeReviewJson(bundle.codexCodeReview.text);
      notes.push(`codexCodeReview: ${p.days.length} days`);
    }
    if (bundle.chatgptGpts) {
      const p = parseGenericChatgptAdminCsv(bundle.chatgptGpts.text);
      notes.push(`chatgptGpts: ${p.rows.length} rows`);
    }
    if (bundle.chatgptProjects) {
      const p = parseGenericChatgptAdminCsv(bundle.chatgptProjects.text);
      notes.push(`chatgptProjects: ${p.rows.length} rows`);
    }
    if (bundle.chatgptImpactSurvey) {
      const p = parseGenericChatgptAdminCsv(bundle.chatgptImpactSurvey.text);
      notes.push(`chatgptImpactSurvey: ${p.rows.length} rows`);
    }
    if (bundle.cursorAnalyticsTeam) {
      const p = parseCursorTeamCsv(bundle.cursorAnalyticsTeam.text);
      notes.push(`cursorAnalyticsTeam: ${p.rows.length} daily rows`);
    }
  } catch (e) {
    notes.push(`parse error: ${(e as Error).message}`);
    return { ok: false, notes };
  }
  return { ok: true, notes };
}

export async function POST(req: NextRequest) {
  const user = await requireRole(["ADMIN", "FINOPS"]);
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `invalid form: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  const { bundle, readErrors } = await readBundleFromForm(form);
  if (readErrors.length > 0) {
    return NextResponse.json({ ok: false, error: readErrors.join("; ") }, { status: 413 });
  }

  const hasAny =
    !!bundle.chatgptUsers ||
    !!bundle.chatgptGpts ||
    !!bundle.chatgptProjects ||
    !!bundle.chatgptImpactSurvey ||
    !!bundle.codexWorkspaceUsage ||
    !!bundle.codexSessionsMessages ||
    !!bundle.codexCodeReview ||
    !!bundle.cursorAnalyticsTeam;

  if (!hasAny) {
    return NextResponse.json(
      { ok: false, error: "no files uploaded (use the named fields from the imports UI)" },
      { status: 400 },
    );
  }

  if (dryRun) {
    const { ok, notes } = dryRunParse(bundle);
    return NextResponse.json({
      ok,
      dryRun: true,
      notes,
      actorEmail: user.email,
    });
  }

  const result = await applyProgramVendorExportBundle(prisma, user.email, bundle);

  if (result.snapshots === 0 && result.errors.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        errors: result.errors,
        kinds: result.kinds,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    dryRun: false,
    snapshots: result.snapshots,
    chatgptVendorDays: result.chatgptVendorDays,
    codexVendorDays: result.codexVendorDays,
    kinds: result.kinds,
    partialErrors: result.errors,
  });
}
