import type { Product, UsageDecision } from "@prisma/client";

/** One normalised row ready for Prisma upsert. */
export type ValidatedUsageIngestEvent = {
  sourceEventId: string;
  userId: string;
  product: Product;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  decision: UsageDecision;
  region: string;
  ts: Date;
  dlpLayersHit: string[];
};

export type UsageIngestRejected = { index: number; reason: string };

export const USAGE_INGEST_MAX_EVENTS = 500;
