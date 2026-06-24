/**
 * Incremental Unified Credit Usage sync (Compliance Logs COSTS event, alpha).
 */

import { DecisionType, type PrismaClient } from "@prisma/client";
import { getIntegrationMode, type IntegrationEnv } from "../env";
import {
  downloadComplianceLogFile,
  listComplianceLogFiles,
  resolveUnifiedCreditsComplianceCredentials,
} from "../openai-compliance/fetch";
import { UNIFIED_CREDITS_EVENT_TYPE } from "./constants";
import { ingestUnifiedCreditsRows } from "./ingest";
import { mapCostsEnvelope, parseUnifiedCreditsJsonl } from "./parse-jsonl";
import {
  hasSeenCostsEventId,
  hasSeenCostsLogFileId,
  loadUnifiedCreditsSyncState,
  rememberCostsEventId,
  rememberCostsLogFileId,
  saveUnifiedCreditsSyncState,
} from "./sync-state";
import type { UnifiedCreditsRow, UnifiedCreditsSyncResult } from "./types";

const LIST_LIMIT = 100;
const MAX_LIST_PAGES = 20;
const MAX_FILES_PER_RUN = 40;
const DEFAULT_INITIAL_LOOKBACK_DAYS = 30;

function isCostsNotEnabledError(message: string): boolean {
  return /invalid event_type/i.test(message) && /costs/i.test(message);
}

export async function syncUnifiedCredits(
  prisma: PrismaClient,
  args: {
    actorEmail: string;
    env?: IntegrationEnv;
    fetchImpl?: typeof fetch;
    initialLookbackDays?: number;
    skipDecision?: boolean;
  },
): Promise<UnifiedCreditsSyncResult> {
  const empty: UnifiedCreditsSyncResult = {
    ok: false,
    filesListed: 0,
    filesDownloaded: 0,
    recordsParsed: 0,
    recordsSkippedDuplicate: 0,
    snapshotsWritten: 0,
    vendorDaysUpserted: 0,
    vendorUserDaysUpserted: 0,
    lastEndTime: null,
  };

  const env = args.env ?? process.env;
  if (getIntegrationMode("openaicompliance", env) !== "real") {
    return { ...empty, reason: "INTEGRATION_OPENAI_COMPLIANCE is not real" };
  }

  const creds = resolveUnifiedCreditsComplianceCredentials(env);
  if (!creds) {
    return {
      ...empty,
      reason: "OPENAI_COMPLIANCE_API_KEY or OPENAI_ORG_ID unset (COSTS uses org-scoped compliance path)",
    };
  }

  const lookbackDays = Math.min(
    Math.max(args.initialLookbackDays ?? DEFAULT_INITIAL_LOOKBACK_DAYS, 1),
    90,
  );
  const defaultAfter = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();

  const state = await loadUnifiedCreditsSyncState(prisma);
  const summary: UnifiedCreditsSyncResult = {
    ok: true,
    filesListed: 0,
    filesDownloaded: 0,
    recordsParsed: 0,
    recordsSkippedDuplicate: 0,
    snapshotsWritten: 0,
    vendorDaysUpserted: 0,
    vendorUserDaysUpserted: 0,
    lastEndTime: state.lastEndTime,
  };

  let cursor = state.lastEndTime ?? defaultAfter;
  let filesThisRun = 0;
  const parsedRows: UnifiedCreditsRow[] = [];

  try {
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const list = await listComplianceLogFiles({
        creds,
        eventType: UNIFIED_CREDITS_EVENT_TYPE,
        after: cursor,
        limit: LIST_LIMIT,
        fetchImpl: args.fetchImpl,
      });
      const files = list.data ?? [];
      summary.filesListed += files.length;

      for (const file of files) {
        if (!file.id || filesThisRun >= MAX_FILES_PER_RUN) continue;
        if (hasSeenCostsLogFileId(state, file.id)) continue;

        filesThisRun += 1;
        summary.filesDownloaded += 1;
        rememberCostsLogFileId(state, file.id);

        const body = await downloadComplianceLogFile({
          creds,
          logId: file.id,
          fetchImpl: args.fetchImpl,
        });

        for (const envRow of parseUnifiedCreditsJsonl(body)) {
          if (hasSeenCostsEventId(state, envRow.event_id)) {
            summary.recordsSkippedDuplicate += 1;
            continue;
          }
          const mapped = mapCostsEnvelope(envRow);
          if (!mapped) continue;
          rememberCostsEventId(state, envRow.event_id);
          summary.recordsParsed += 1;
          parsedRows.push(mapped);
        }

        if (file.end_time) {
          state.lastEndTime = file.end_time;
          summary.lastEndTime = file.end_time;
        }
      }

      if (filesThisRun >= MAX_FILES_PER_RUN) break;
      if (list.has_more !== true || !list.last_end_time) break;
      cursor = list.last_end_time;
      state.lastEndTime = list.last_end_time;
      summary.lastEndTime = list.last_end_time;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isCostsNotEnabledError(message)) {
      return {
        ...empty,
        ok: false,
        notEnabled: true,
        reason:
          "Compliance API rejected event_type=COSTS — confirm OPENAI_ORG_ID and org-scoped enablement.",
      };
    }
    return { ...empty, ok: false, reason: message };
  }

  if (parsedRows.length > 0) {
    const ing = await ingestUnifiedCreditsRows(prisma, {
      rows: parsedRows,
      actorEmail: args.actorEmail,
    });
    summary.snapshotsWritten = ing.snapshotsWritten;
    summary.vendorDaysUpserted = ing.vendorDaysUpserted;
    summary.vendorUserDaysUpserted = ing.vendorUserDaysUpserted;
  }

  await saveUnifiedCreditsSyncState(prisma, state, args.actorEmail);

  if (!args.skipDecision) {
    await prisma.decision.create({
      data: {
        type: DecisionType.PROGRAM_VENDOR_EXPORT_IMPORT,
        beforeState: "{}",
        afterState: JSON.stringify(summary),
        actorEmail: args.actorEmail,
        justification: `Unified Credit Usage (COSTS) sync: files=${summary.filesDownloaded} records=${summary.recordsParsed} vendorDays=${summary.vendorDaysUpserted}`,
      },
    });
  }

  return summary;
}
