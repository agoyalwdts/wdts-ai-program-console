/**
 * Parse Cursor team-usage CSV exports. Headers are slugged (spaces →
 * underscores) so we accept common Cursor column spellings.
 */

import Papa from "papaparse";
import type { CursorUsageParsedRow } from "./types";

export type ParseCursorUsageResult =
  | {
      ok: true;
      rows: CursorUsageParsedRow[];
      rowsSkipped: number;
      parseErrors: string[];
    }
  | { ok: false; error: string };

function slugHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function pickInt(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function pickFloat(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function pickBoolMaxMode(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "yes" || s === "true" || s === "1";
}

export function parseCursorUsageCsv(csvText: string): ParseCursorUsageResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: slugHeader,
  });

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    return {
      ok: false,
      error: parsed.errors.map((e) => e.message).join("; "),
    };
  }

  const rows: CursorUsageParsedRow[] = [];
  let rowsSkipped = 0;
  const parseErrors: string[] = [];

  for (let i = 0; i < parsed.data.length; i++) {
    const rec = parsed.data[i];
    if (!rec || Object.keys(rec).every((k) => !String(rec[k] ?? "").trim())) {
      continue;
    }

    const dateRaw = rec.date ?? rec.timestamp ?? rec.time ?? "";
    const userEmail = (rec.user ?? rec.email ?? rec.user_email ?? "").trim();
    const model = (rec.model ?? "").trim();
    const maxRaw = rec.max_mode ?? rec.maxmode ?? "";

    const inputCacheWrite = pickInt(
      rec.input_w_cache_write ??
        rec.input_cache_write ??
        rec.cached_write_input ??
        rec.input_cached_write,
    );
    const inputNoCache = pickInt(
      rec.input_no_cache ?? rec.input_without_cache ?? rec.uncached_input,
    );
    const cacheRead = pickInt(rec.cache_read ?? rec.cached_read);
    const outputTokens = pickInt(rec.output_tokens ?? rec.output);
    const totalTokens = pickInt(rec.total_tokens ?? rec.total);
    const costUsd = pickFloat(rec.cost ?? rec.cost_usd ?? rec.usd);

    const occurredAt = new Date(dateRaw);
    if (!dateRaw || Number.isNaN(occurredAt.getTime())) {
      rowsSkipped++;
      parseErrors.push(`row ${i + 2}: invalid or missing date`);
      continue;
    }
    if (!userEmail || !model) {
      rowsSkipped++;
      continue;
    }

    rows.push({
      occurredAt,
      userEmail: userEmail.toLowerCase(),
      team: (rec.team ?? "").trim(),
      kind: (rec.kind ?? "").trim(),
      model,
      maxMode: pickBoolMaxMode(maxRaw),
      inputCacheWrite,
      inputNoCache,
      cacheRead,
      outputTokens,
      totalTokens,
      costUsd,
    });
  }

  return { ok: true, rows, rowsSkipped, parseErrors };
}
