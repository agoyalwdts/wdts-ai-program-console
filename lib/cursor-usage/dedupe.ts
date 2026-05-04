import { createHash } from "node:crypto";
import type { CursorUsageParsedRow } from "./types";

/** Stable id so re-uploading the same CSV does not duplicate alerts. */
export function prudenceDedupeKey(
  row: CursorUsageParsedRow,
  ruleCode: string,
): string {
  const payload = [
    row.occurredAt.toISOString(),
    row.userEmail,
    row.model,
    row.maxMode ? "1" : "0",
    row.inputCacheWrite,
    row.inputNoCache,
    row.cacheRead,
    row.outputTokens,
    row.totalTokens,
    row.costUsd.toFixed(6),
    ruleCode,
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}
