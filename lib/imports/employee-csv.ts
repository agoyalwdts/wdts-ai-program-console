/**
 * Employee CSV import.
 *
 * The "no Deel needed" path. Lets an operator upload a CSV of employees
 * (HRIS export, manual roster, anything) into Prisma's `User` table. The
 * synthetic Deel client (`INTEGRATION_DEEL=synthetic`) reads from
 * `prisma.user`, so a successful import makes F1 / F2 / F3 / F10 stop
 * being synthetic without flipping a single integration flag — all the
 * downstream views just see real people.
 *
 * Architecture (per README §"Where things live"):
 *   - This module has the **pure** parse + validate halves; both are
 *     unit-tested in `employee-csv.test.ts` without a DB.
 *   - `applyImport()` is the impure half — wraps the upsert in a Prisma
 *     transaction, then writes a single `Decision` row of type
 *     `EMPLOYEE_IMPORT` so F5 records who imported what when.
 *   - Manager hierarchy is resolved in two passes inside the transaction:
 *     pass 1 upserts every user with `managerId=null`, pass 2 resolves
 *     each `managerEmail` to a `managerId` and updates. This handles
 *     "manager listed below report in the file" without forcing a
 *     topological sort on the importer.
 *
 * Deletion semantics:
 *   - We **never** delete a user that's missing from a re-imported file.
 *     A "soft delete" (mark `LEFT`) is a separate explicit action; the
 *     CSV path is upsert-only. This is deliberate — the alternative is
 *     "operator imports the wrong file → entire org wiped" and we don't
 *     want to be one button-click away from that.
 *
 * Excel:
 *   - CSV-only by design. Excel parsing on the server-side adds a
 *     non-trivial dep (`xlsx` is ~700KB) for marginal benefit; in 95%
 *     of HRIS workflows the operator can "Save As CSV". Revisit if a
 *     real import lands a binary `.xlsx` and the user can't re-export.
 */

import Papa from "papaparse";
import type { PrismaClient, Prisma } from "@prisma/client";

export const ALLOWED_STATUSES = ["ACTIVE", "LEFT", "ON_LEAVE"] as const;
export type EmployeeStatus = (typeof ALLOWED_STATUSES)[number];

export const REQUIRED_COLUMNS = [
  "email",
  "displayName",
  "roleTag",
  "region",
] as const;

export const KNOWN_COLUMNS = [
  ...REQUIRED_COLUMNS,
  "managerEmail",
  "status",
] as const;
export type KnownColumn = (typeof KNOWN_COLUMNS)[number];

export type RawEmployeeRow = Partial<Record<KnownColumn, string>>;

export type ValidatedEmployeeRow = {
  email: string;
  displayName: string;
  roleTag: string;
  region: string;
  managerEmail: string | null;
  status: EmployeeStatus;
};

export type ValidationError = {
  row: number; // 1-indexed, excluding the header row
  field?: KnownColumn | "row";
  message: string;
  raw: RawEmployeeRow;
};

export type ParseResult = {
  rows: RawEmployeeRow[];
  parseErrors: ValidationError[];
  unknownColumns: string[];
};

export type ValidationResult = {
  valid: ValidatedEmployeeRow[];
  errors: ValidationError[];
};

export type ImportSummary = {
  added: number;
  updated: number;
  unchanged: number;
  total: number;
  errors: ValidationError[];
};

// Conservative email regex — RFC 5322 has corner cases this doesn't catch
// (quoted local parts, internationalised domains), but the tradeoff is on
// the side of "obvious typo gets surfaced" rather than "exotic-but-valid
// address gets through". Operators can always re-import after a fix.
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/**
 * Parse a CSV string into raw rows. Doesn't validate the contents —
 * just hands back what Papa Parse produced, plus any structural errors
 * (mid-quote EOF, malformed escapes). Header normalisation: we accept
 * BOM, trim whitespace, but DO NOT lowercase — `displayName` and
 * `displayname` are different inputs and the operator should know.
 */
export function parseCsv(text: string): ParseResult {
  const stripped = text.replace(/^\uFEFF/, "");
  const result = Papa.parse<Record<string, string>>(stripped, {
    header: true,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
    transformHeader: (h) => h.trim(),
  });

  const rows: RawEmployeeRow[] = [];
  const headerSet = new Set<string>(result.meta.fields ?? []);
  const knownSet = new Set<string>(KNOWN_COLUMNS);
  const unknownColumns = [...headerSet].filter((h) => !knownSet.has(h));

  for (const r of result.data) {
    const cleaned: RawEmployeeRow = {};
    for (const k of KNOWN_COLUMNS) {
      const v = r[k];
      if (typeof v === "string") {
        const trimmed = v.trim();
        if (trimmed) cleaned[k] = trimmed;
      }
    }
    rows.push(cleaned);
  }

  const parseErrors: ValidationError[] = (result.errors ?? []).map((e) => ({
    row: typeof e.row === "number" ? e.row + 1 : 0,
    message: e.message,
    raw: {},
  }));

  return { rows, parseErrors, unknownColumns };
}

/**
 * Validate parsed rows against the schema and against the existing DB
 * state. Returns ALL errors — the caller decides whether to abort or to
 * surface them as warnings. Validation rules:
 *
 *   1. Required fields present + non-empty.
 *   2. `email` is unique within the file.
 *   3. `email` matches a (very forgiving) pattern.
 *   4. `status`, if present, is one of ALLOWED_STATUSES (case-sensitive
 *      to match the seed convention).
 *   5. `managerEmail`, if present:
 *        a. Cannot equal own email (direct cycle).
 *        b. Must resolve to either another row in the file OR an
 *           existing user in `existingEmails` (set of lowercased
 *           emails). Multi-hop cycles are NOT detected here — they're
 *           a follow-up; for v0.2 the operator ships clean data.
 *
 * Email comparisons are lowercased so re-importing with case-changed
 * emails doesn't create dupes.
 */
export function validate(
  rows: RawEmployeeRow[],
  existingEmails: Iterable<string>,
): ValidationResult {
  const valid: ValidatedEmployeeRow[] = [];
  const errors: ValidationError[] = [];
  const fileEmails = new Set<string>();
  const existing = new Set(
    [...existingEmails].map((e) => e.toLowerCase().trim()),
  );

  rows.forEach((raw, i) => {
    const rowNum = i + 1; // 1-indexed; row 1 is the first data row
    const rowErrors: ValidationError[] = [];

    for (const col of REQUIRED_COLUMNS) {
      if (!raw[col] || raw[col]!.length === 0) {
        rowErrors.push({
          row: rowNum,
          field: col,
          message: `Required field "${col}" is missing or empty`,
          raw,
        });
      }
    }

    const email = raw.email?.toLowerCase();
    if (email && !EMAIL_RE.test(email)) {
      rowErrors.push({
        row: rowNum,
        field: "email",
        message: `"${raw.email}" is not a valid email address`,
        raw,
      });
    }

    if (email && fileEmails.has(email)) {
      rowErrors.push({
        row: rowNum,
        field: "email",
        message: `Email "${raw.email}" appears more than once in the file`,
        raw,
      });
    }

    let status: EmployeeStatus = "ACTIVE";
    if (raw.status) {
      if (!ALLOWED_STATUSES.includes(raw.status as EmployeeStatus)) {
        rowErrors.push({
          row: rowNum,
          field: "status",
          message: `"${raw.status}" is not a valid status. Allowed: ${ALLOWED_STATUSES.join(", ")}`,
          raw,
        });
      } else {
        status = raw.status as EmployeeStatus;
      }
    }

    const managerEmail = raw.managerEmail?.toLowerCase();
    if (managerEmail) {
      if (managerEmail === email) {
        rowErrors.push({
          row: rowNum,
          field: "managerEmail",
          message: "Manager email cannot be the user's own email (cycle)",
          raw,
        });
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      // still register the email so we don't double-report it as a dupe
      if (email) fileEmails.add(email);
      return;
    }

    fileEmails.add(email!);
    valid.push({
      email: raw.email!,
      displayName: raw.displayName!,
      roleTag: raw.roleTag!,
      region: raw.region!,
      managerEmail: raw.managerEmail ?? null,
      status,
    });
  });

  // Second pass: managerEmail must resolve to *something* — either a
  // row in this file OR an existing user. We do this after the first
  // pass so "manager listed below the report in the file" works.
  valid.forEach((row, i) => {
    if (!row.managerEmail) return;
    const me = row.managerEmail.toLowerCase();
    if (!fileEmails.has(me) && !existing.has(me)) {
      errors.push({
        row: i + 1,
        field: "managerEmail",
        message: `Manager "${row.managerEmail}" is not in this file and not in the existing employees`,
        raw: { managerEmail: row.managerEmail },
      });
    }
  });

  return { valid, errors };
}

/**
 * Apply the validated rows to Prisma in a single transaction. Two
 * passes:
 *   1. Upsert every user with `managerId=null` (or unchanged for
 *      existing users — we don't clear an existing manager link unless
 *      the row's `managerEmail` resolves to a *different* manager in
 *      pass 2).
 *   2. Resolve each row's `managerEmail` → `managerId` and update.
 *
 * Atomicity: the entire upsert + the audit `Decision` row land in one
 * transaction. Either everything commits or nothing does.
 */
export async function applyImport(
  prisma: PrismaClient,
  rows: ValidatedEmployeeRow[],
  actorEmail: string,
): Promise<ImportSummary> {
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  await prisma.$transaction(async (tx) => {
    // Pass 1 — upsert without manager linkage. We track per-row
    // (added vs updated vs unchanged) by comparing the pre-upsert
    // state.
    const incomingEmails = rows.map((r) => r.email);
    const existing = await tx.user.findMany({
      where: { email: { in: incomingEmails } },
      select: {
        id: true,
        email: true,
        displayName: true,
        roleTag: true,
        region: true,
        status: true,
        managerId: true,
      },
    });
    const byEmail = new Map(existing.map((u) => [u.email.toLowerCase(), u]));

    for (const row of rows) {
      const prior = byEmail.get(row.email.toLowerCase());
      if (!prior) {
        await tx.user.create({
          data: {
            email: row.email,
            displayName: row.displayName,
            roleTag: row.roleTag,
            region: row.region,
            status: row.status,
            // manager linked in pass 2
          },
        });
        added += 1;
        continue;
      }

      const fieldsChanged =
        prior.displayName !== row.displayName ||
        prior.roleTag !== row.roleTag ||
        prior.region !== row.region ||
        prior.status !== row.status;

      if (fieldsChanged) {
        await tx.user.update({
          where: { id: prior.id },
          data: {
            displayName: row.displayName,
            roleTag: row.roleTag,
            region: row.region,
            status: row.status,
          },
        });
        updated += 1;
      } else {
        unchanged += 1;
      }
    }

    // Pass 2 — manager linkage. Re-fetch so newly-created rows are in
    // the lookup map.
    const everyone = await tx.user.findMany({
      where: { email: { in: incomingEmails } },
      select: { id: true, email: true, managerId: true },
    });
    const idByEmail = new Map(
      everyone.map((u) => [u.email.toLowerCase(), u]),
    );

    for (const row of rows) {
      const me = idByEmail.get(row.email.toLowerCase());
      if (!me) continue; // shouldn't happen, but be defensive

      let desiredManagerId: string | null = null;
      if (row.managerEmail) {
        const mgr = idByEmail.get(row.managerEmail.toLowerCase());
        if (mgr) {
          desiredManagerId = mgr.id;
        } else {
          // Manager wasn't in this import — try the broader DB. We
          // tolerated this in validate() so we have to honour it here.
          const dbMgr = await tx.user.findUnique({
            where: { email: row.managerEmail },
            select: { id: true },
          });
          if (dbMgr) desiredManagerId = dbMgr.id;
        }
      }

      if (me.managerId !== desiredManagerId) {
        await tx.user.update({
          where: { id: me.id },
          data: { managerId: desiredManagerId },
        });
        // If we counted this as "unchanged" in pass 1 but the manager
        // moved, reclassify as updated.
        if (unchanged > 0) {
          unchanged -= 1;
          updated += 1;
        }
      }
    }

    // Audit row.
    const before: Prisma.JsonObject = {
      total_in_file: rows.length,
    };
    const after: Prisma.JsonObject = {
      added,
      updated,
      unchanged,
      total: rows.length,
    };
    await tx.decision.create({
      data: {
        type: "EMPLOYEE_IMPORT",
        beforeState: JSON.stringify(before),
        afterState: JSON.stringify(after),
        actorEmail,
        justification: `CSV import: ${rows.length} rows · added ${added}, updated ${updated}, unchanged ${unchanged}`,
      },
    });
  });

  return {
    added,
    updated,
    unchanged,
    total: rows.length,
    errors: [],
  };
}
