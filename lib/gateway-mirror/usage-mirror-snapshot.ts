import type { PrismaClient } from "@prisma/client";
import { getIntegrationMode, type IntegrationMode } from "@/lib/integrations/env";
import { evaluateGatewayMirrorHealth, type MirrorHealthResult } from "./mirror-health";

export type UsageMirrorSnapshot = {
  gatewayMode: IntegrationMode;
  totalRows: number;
  lastUsageEventAt: string | null;
  lastIngestBatchAt: string | null;
  rowsLast2Hours: number;
  rowsLast24Hours: number;
  mirrorHealth: MirrorHealthResult;
  usageIngestSecretSet: boolean;
};

export async function getUsageMirrorSnapshot(
  prisma: PrismaClient,
): Promise<UsageMirrorSnapshot> {
  const now = Date.now();
  const since2h = new Date(now - 2 * 60 * 60 * 1000);
  const since24h = new Date(now - 24 * 60 * 60 * 1000);

  const [totalRows, lastUsage, lastBatch, rowsLast2Hours, rowsLast24Hours, mirrorHealth] =
    await Promise.all([
      prisma.usageRecord.count(),
      prisma.usageRecord.aggregate({ _max: { ts: true } }),
      prisma.decision.findFirst({
        where: { type: "USAGE_INGEST_BATCH" },
        orderBy: { ts: "desc" },
        select: { ts: true },
      }),
      prisma.usageRecord.count({ where: { ts: { gte: since2h } } }),
      prisma.usageRecord.count({ where: { ts: { gte: since24h } } }),
      evaluateGatewayMirrorHealth(prisma, {
        maxStaleMs: 24 * 60 * 60 * 1000,
        requireBatch: false,
      }),
    ]);

  const secret = process.env.USAGE_INGEST_HMAC_SECRET?.trim();

  return {
    gatewayMode: getIntegrationMode("gateway"),
    totalRows,
    lastUsageEventAt: lastUsage._max.ts?.toISOString() ?? null,
    lastIngestBatchAt: lastBatch?.ts.toISOString() ?? null,
    rowsLast2Hours,
    rowsLast24Hours,
    mirrorHealth,
    usageIngestSecretSet: Boolean(secret),
  };
}
