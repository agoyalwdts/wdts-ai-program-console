import type { PrismaClient } from "@prisma/client";

export type ManualVendorSnapshotDTO = {
  kind: string;
  filename: string;
  createdAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  rowCount: number;
  payload: unknown;
};

export async function loadLatestProgramVendorExportSnapshots(
  prisma: PrismaClient,
): Promise<ManualVendorSnapshotDTO[]> {
  const rows = await prisma.programVendorExportSnapshot.findMany({
    orderBy: { createdAt: "desc" },
    take: 120,
  });
  const byKind = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (!byKind.has(r.kind)) byKind.set(r.kind, r);
  }
  return [...byKind.values()].map((r) => ({
    kind: r.kind,
    filename: r.filename,
    createdAt: r.createdAt.toISOString(),
    periodStart: r.periodStart ? r.periodStart.toISOString().slice(0, 10) : null,
    periodEnd: r.periodEnd ? r.periodEnd.toISOString().slice(0, 10) : null,
    rowCount: r.rowCount,
    payload: r.payload,
  }));
}
