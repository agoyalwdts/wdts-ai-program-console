import type { PrismaClient } from "@prisma/client";
import type { ValidatedUsageIngestEvent } from "./types";

export async function upsertValidatedUsageEvents(
  prisma: PrismaClient,
  events: ValidatedUsageIngestEvent[],
): Promise<{ upserted: number }> {
  if (events.length === 0) return { upserted: 0 };

  let upserted = 0;
  await prisma.$transaction(async (tx) => {
    for (const e of events) {
      await tx.usageRecord.upsert({
        where: { sourceEventId: e.sourceEventId },
        create: {
          userId: e.userId,
          product: e.product,
          model: e.model,
          tokensIn: e.tokensIn,
          tokensOut: e.tokensOut,
          costUsd: e.costUsd,
          decision: e.decision,
          region: e.region,
          ts: e.ts,
          dlpLayersHit: e.dlpLayersHit,
          sourceEventId: e.sourceEventId,
        },
        update: {
          model: e.model,
          tokensIn: e.tokensIn,
          tokensOut: e.tokensOut,
          costUsd: e.costUsd,
          decision: e.decision,
          region: e.region,
          ts: e.ts,
          dlpLayersHit: e.dlpLayersHit,
        },
      });
      upserted++;
    }
  });

  return { upserted };
}
