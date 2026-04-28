/**
 * GatewayClient — abstraction over the AI gateway (Portkey / LiteLLM /
 * Helicone, vendor TBD per Phase 0). Returns usage records and aggregates
 * sourced from the gateway audit log.
 *
 * Refs: Dashboard_Scoping_v1.md §4 (integration #2), §3.1 (UsageRecord shape),
 *       Executive_Policy_and_Guardrails.md §4.6 (per-tier caps).
 *
 * Authoritative source: gateway audit log. The dashboard mirrors usage data
 * into Postgres for v1 (see scoping §3.3 / §6 Q4) but never holds it
 * authoritatively.
 */

import type { ProductKey } from "@/lib/program";

export type UsageDecision = "ALLOWED" | "PROMPTED" | "BLOCKED" | "DOWNGRADED";

export type UsageRecord = {
  userId: string;
  product: ProductKey;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  decision: UsageDecision;
  region: string;
  ts: Date;
};

export type UsageAggregate = {
  userId: string;
  product: ProductKey;
  /** First of the period at 00:00 UTC. */
  periodStart: Date;
  /** Inclusive end of the period at 23:59:59.999 UTC. */
  periodEnd: Date;
  totalUsd: number;
  requestCount: number;
};

export type ProgramAggregate = {
  product: ProductKey;
  periodStart: Date;
  periodEnd: Date;
  totalUsd: number;
  requestCount: number;
};

export type DailyProgramAggregate = {
  /** Local-time date string in `M/D` form so it can drive a chart x-axis. */
  day: string;
  /** Per-product spend for that day, USD. */
  byProduct: Record<ProductKey, number>;
};

export type TopSpender = {
  userId: string;
  totalUsd: number;
  /** Number of usage records the user produced in the window. */
  requestCount: number;
};

export type ManagerQueueRow = {
  userId: string;
  email: string;
  displayName: string;
  /** % of the user's per-product cap consumed this calendar month, 0..1 (or > 1 if over cap). */
  capUtilisation: Record<ProductKey, number | null>;
  /** Days since the user's last allowed usage record across any product (null if never). */
  idleDays: number | null;
  /** Total spend across all products in the current calendar month, USD. */
  mtdSpendUsd: number;
};

export type GatewayClient = {
  /** Raw usage records for a user across the given window. Used by F2 (per-user view). */
  listUsageRecords(args: {
    userId: string;
    /** Inclusive lower bound. */
    since: Date;
    /** Inclusive upper bound. Defaults to now. */
    until?: Date;
    /** Optional product filter. Omit to return all products. */
    product?: ProductKey;
    /** Cap on returned rows; default 200, max 1000. */
    limit?: number;
  }): Promise<UsageRecord[]>;

  /** Per-user aggregates for the given period. Used by F2 (MTD/EOM) and F3. */
  aggregateByUser(args: {
    userIds?: string[];
    periodStart: Date;
    periodEnd: Date;
  }): Promise<UsageAggregate[]>;

  /** Program-level aggregates per product. Used by F1 (program health header). */
  aggregateByProgram(args: {
    periodStart: Date;
    periodEnd: Date;
  }): Promise<ProgramAggregate[]>;

  /**
   * Per-day program-level aggregates per product across the given window.
   * Returns one row per calendar day in `[since, until]` (zero-filled if no
   * activity). Used by the F1 daily-spend stacked area chart.
   */
  aggregateByProgramDaily(args: {
    since: Date;
    until?: Date;
  }): Promise<DailyProgramAggregate[]>;

  /**
   * Top spenders in the window, sorted by total USD descending. Used by
   * F1 (top-10 board) and F10 (overage / chargeback).
   */
  topSpenders(args: {
    periodStart: Date;
    periodEnd: Date;
    limit?: number;
  }): Promise<TopSpender[]>;

  /**
   * Manager-queue view: each direct report's cap utilisation, idle days, and
   * MTD spend. Used by F3.
   *
   * `managerUserId` is the manager's own User.id; the returned rows are for
   * users whose `managerId === managerUserId`.
   */
  managerQueue(args: { managerUserId: string }): Promise<ManagerQueueRow[]>;
};
