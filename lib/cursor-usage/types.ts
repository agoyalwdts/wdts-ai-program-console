/**
 * Parsed row from Cursor team-usage CSV (admin export). Column names are
 * normalised by the parser; see parse-csv.ts.
 */

export type CursorUsageParsedRow = {
  occurredAt: Date;
  userEmail: string;
  team: string;
  kind: string;
  model: string;
  maxMode: boolean;
  inputCacheWrite: number;
  inputNoCache: number;
  cacheRead: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
};

export type PrudenceEvaluation = {
  ruleCode: string;
  title: string;
  rationale: string;
};
