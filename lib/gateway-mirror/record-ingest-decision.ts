/**
 * Append-only Decision row for gateway mirror webhook batches (F5).
 *
 * Actor is a fixed sentinel — there is no interactive user on webhook paths.
 */

import type { PrismaClient } from "@prisma/client";

export const GATEWAY_MIRROR_ACTOR_EMAIL = "gateway-mirror.ingest@wdts.local";

export type UsageIngestBatchSource = "litellm" | "generic_usage_ingest";

export type RejectedEntry = { index?: number; reason: string };

/**
 * Records a `USAGE_INGEST_BATCH` decision when at least one row was upserted.
 * Skips silently when nothing was written (idempotent re-posts).
 */
export async function recordUsageIngestBatchDecision(
  prisma: PrismaClient,
  args: {
    source: UsageIngestBatchSource;
    upserted: number;
    accepted: number;
    rejected: RejectedEntry[];
  },
): Promise<void> {
  if (args.upserted <= 0) return;

  const beforeState = JSON.stringify({ source: args.source });
  const afterState = JSON.stringify({
    upserted: args.upserted,
    accepted: args.accepted,
    rejectedCount: args.rejected.length,
    rejectedSample: args.rejected.slice(0, 25),
  });

  await prisma.decision.create({
    data: {
      type: "USAGE_INGEST_BATCH",
      beforeState,
      afterState,
      actorEmail: GATEWAY_MIRROR_ACTOR_EMAIL,
      justification: `${args.source} usage mirror: ${args.upserted} row(s) upserted, ${args.accepted} accepted, ${args.rejected.length} rejected`,
    },
  });
}
