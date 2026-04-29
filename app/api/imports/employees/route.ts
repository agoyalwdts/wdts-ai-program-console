/**
 * Employee CSV import endpoint.
 *
 * POST /api/imports/employees
 *   - multipart/form-data with a `file` field, OR
 *   - text/csv body (mirrored for curl-from-laptop convenience)
 *
 * GET ?dryRun=1 is intentionally unsupported — POST with `?dryRun=1` is
 * the dry-run knob (parses + validates but skips the applyImport call,
 * so the operator can preview a file before committing).
 *
 * Auth: ADMIN | FINOPS only. The proxy already rejects unauth'd
 * requests, but Server Functions / route handlers are NOT in the proxy
 * chain in Next 16, so we re-assert here.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  parseCsv,
  validate,
  applyImport,
  type ValidationError,
} from "@/lib/imports/employee-csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 5 MB ceiling. A clean CSV of 30k rows is ~3 MB; if you're past 5 MB
// you probably want a real HRIS reconciler, not the CSV path.
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const user = await requireRole(["ADMIN", "FINOPS"]);

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  let csvText: string;
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

  const { rows, parseErrors, unknownColumns } = parseCsv(csvText);
  if (rows.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "no data rows found in the file",
        parseErrors,
        unknownColumns,
      },
      { status: 400 },
    );
  }

  const existing = await prisma.user.findMany({ select: { email: true } });
  const { valid, errors: validationErrors } = validate(
    rows,
    existing.map((u) => u.email),
  );

  const errors: ValidationError[] = [...parseErrors, ...validationErrors];

  // Block-on-errors policy: any validation error → 422 with no writes.
  // Operator fixes the file and re-uploads. This is friendlier than
  // a partial write that leaves the DB in a weird state.
  if (errors.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        dryRun,
        rowsParsed: rows.length,
        rowsValid: valid.length,
        unknownColumns,
        errors,
      },
      { status: 422 },
    );
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      rowsParsed: rows.length,
      rowsValid: valid.length,
      unknownColumns,
      // No counts because we haven't compared against existing rows yet
      // beyond email-collision detection. Counts come from a real run.
    });
  }

  const summary = await applyImport(prisma, valid, user.email);

  return NextResponse.json({
    ok: true,
    dryRun: false,
    rowsParsed: rows.length,
    rowsValid: valid.length,
    unknownColumns,
    summary,
  });
}
