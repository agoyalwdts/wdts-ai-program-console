import type { PrismaClient } from "@prisma/client";
import type { SyncJobKey, SyncTrigger } from "./types";

export async function getSyncLedgerRow(
  prisma: PrismaClient,
  key: SyncJobKey,
): Promise<{
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  lastTrigger: string | null;
  lastError: string | null;
}> {
  const row = await prisma.integrationSyncState.findUnique({
    where: { key },
    select: {
      lastSuccessAt: true,
      lastAttemptAt: true,
      lastTrigger: true,
      lastError: true,
    },
  });
  return {
    lastSuccessAt: row?.lastSuccessAt ?? null,
    lastAttemptAt: row?.lastAttemptAt ?? null,
    lastTrigger: row?.lastTrigger ?? null,
    lastError: row?.lastError ?? null,
  };
}

export async function recordSyncAttempt(
  prisma: PrismaClient,
  key: SyncJobKey,
  trigger: SyncTrigger,
): Promise<void> {
  await prisma.integrationSyncState.upsert({
    where: { key },
    create: {
      key,
      lastAttemptAt: new Date(),
      lastTrigger: trigger,
    },
    update: {
      lastAttemptAt: new Date(),
      lastTrigger: trigger,
    },
  });
}

export async function recordSyncSuccess(
  prisma: PrismaClient,
  key: SyncJobKey,
  trigger: SyncTrigger,
  summary: Record<string, unknown>,
): Promise<void> {
  const now = new Date();
  await prisma.integrationSyncState.upsert({
    where: { key },
    create: {
      key,
      lastSuccessAt: now,
      lastAttemptAt: now,
      lastTrigger: trigger,
      lastError: null,
      lastSummary: summary as object,
    },
    update: {
      lastSuccessAt: now,
      lastAttemptAt: now,
      lastTrigger: trigger,
      lastError: null,
      lastSummary: summary as object,
    },
  });
}

export async function recordSyncFailure(
  prisma: PrismaClient,
  key: SyncJobKey,
  trigger: SyncTrigger,
  error: string,
): Promise<void> {
  await prisma.integrationSyncState.upsert({
    where: { key },
    create: {
      key,
      lastAttemptAt: new Date(),
      lastTrigger: trigger,
      lastError: error,
    },
    update: {
      lastAttemptAt: new Date(),
      lastTrigger: trigger,
      lastError: error,
    },
  });
}
