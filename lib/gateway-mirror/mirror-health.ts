import type { PrismaClient } from "@prisma/client";

export type MirrorHealthResult =
  | {
      ok: true;
      lastIngestBatchAt: string | null;
      lastUsageEventAt: string | null;
      stale: false;
    }
  | {
      ok: false;
      lastIngestBatchAt: string | null;
      lastUsageEventAt: string | null;
      stale: true;
      reason: string;
    };

/**
 * Compares latest `USAGE_INGEST_BATCH` decision timestamp to `maxStaleMs`.
 * When `requireBatch` is false, missing batches do not fail (greenfield).
 */
export async function evaluateGatewayMirrorHealth(
  prisma: PrismaClient,
  args: { maxStaleMs: number; requireBatch: boolean },
): Promise<MirrorHealthResult> {
  const lastBatch = await prisma.decision.findFirst({
    where: { type: "USAGE_INGEST_BATCH" },
    orderBy: { ts: "desc" },
    select: { ts: true },
  });

  const lastUsage = await prisma.usageRecord.aggregate({
    _max: { ts: true },
  });

  const lastIngestBatchAt = lastBatch?.ts.toISOString() ?? null;
  const lastUsageEventAt = lastUsage._max.ts?.toISOString() ?? null;
  const now = Date.now();

  if (args.requireBatch && !lastBatch) {
    return {
      ok: false,
      lastIngestBatchAt,
      lastUsageEventAt,
      stale: true,
      reason: "no USAGE_INGEST_BATCH decision yet (webhook never succeeded with upserts)",
    };
  }

  if (lastBatch) {
    const age = now - lastBatch.ts.getTime();
    if (age > args.maxStaleMs) {
      return {
        ok: false,
        lastIngestBatchAt,
        lastUsageEventAt,
        stale: true,
        reason: `last ingest batch older than ${Math.round(args.maxStaleMs / 60_000)} minutes`,
      };
    }
  }

  return {
    ok: true,
    lastIngestBatchAt,
    lastUsageEventAt,
    stale: false,
  };
}
