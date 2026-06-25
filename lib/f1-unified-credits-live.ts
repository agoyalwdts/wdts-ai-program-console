/**
 * Live Unified Credits COSTS fetch for F1 — matches OpenAI Admin → Credits tab.
 *
 * organization/costs is USD API spend; Workspace Analytics undercounts org pool.
 * Compliance COSTS events carry credit consumption (billing.measures in CREDITS).
 */

import { Product } from "@prisma/client";
import { getIntegrationMode } from "@/lib/integrations/env";
import {
  downloadComplianceLogFile,
  listComplianceLogFiles,
  resolveUnifiedCreditsComplianceCredentials,
} from "@/lib/integrations/openai-compliance/fetch";
import { UNIFIED_CREDITS_EVENT_TYPE } from "@/lib/integrations/unified-credits/constants";
import { productFromCostsRow } from "@/lib/integrations/unified-credits/ingest";
import { mapCostsEnvelope, parseUnifiedCreditsJsonl } from "@/lib/integrations/unified-credits/parse-jsonl";
import { OPENAI_CREDIT_OVERAGE_USD } from "@/lib/program";

const LIST_LIMIT = 100;
const MAX_LIST_PAGES = 30;
const MAX_FILES_PER_FETCH = 120;

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function ymdInPeriod(ymd: string, periodStart: Date, periodEnd: Date): boolean {
  const day = startOfLocalDay(new Date(`${ymd}T12:00:00`));
  const start = startOfLocalDay(periodStart);
  const end = startOfLocalDay(periodEnd);
  return day.getTime() >= start.getTime() && day.getTime() <= end.getTime();
}

export type UnifiedCreditsPeriodLayers = {
  unifiedChatByYmd: Map<string, number>;
  unifiedCodByYmd: Map<string, number>;
  chatgptCredits: number;
  codexCredits: number;
  totalCredits: number;
  source: "live";
};

/** Pull COSTS compliance logs for the F1 window and aggregate credits by day + product. */
export async function fetchUnifiedCreditsPeriodLayers(args: {
  periodStart: Date;
  periodEnd: Date;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  maxFiles?: number;
}): Promise<UnifiedCreditsPeriodLayers | null> {
  const env = args.env ?? process.env;
  if (getIntegrationMode("openaicompliance", env) !== "real") return null;

  const creds = resolveUnifiedCreditsComplianceCredentials(env);
  if (!creds) return null;

  const after = new Date(args.periodStart.getTime() - 86_400_000).toISOString();
  const maxFiles = args.maxFiles ?? MAX_FILES_PER_FETCH;

  const creditsByDayProduct = new Map<string, { chat: number; cod: number }>();
  const seenEventIds = new Set<string>();
  let filesDownloaded = 0;

  try {
    let cursor = after;

    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const list = await listComplianceLogFiles({
        creds,
        eventType: UNIFIED_CREDITS_EVENT_TYPE,
        after: cursor,
        limit: LIST_LIMIT,
        fetchImpl: args.fetchImpl,
      });

      for (const file of list.data ?? []) {
        if (!file.id || filesDownloaded >= maxFiles) continue;

        filesDownloaded += 1;
        const body = await downloadComplianceLogFile({
          creds,
          logId: file.id,
          fetchImpl: args.fetchImpl,
        });

        for (const envRow of parseUnifiedCreditsJsonl(body)) {
          if (seenEventIds.has(envRow.event_id)) continue;
          const row = mapCostsEnvelope(envRow);
          if (!row || !ymdInPeriod(row.day, args.periodStart, args.periodEnd)) continue;
          seenEventIds.add(row.event_id);

          const product = productFromCostsRow(row);
          if (!product) continue;

          const agg = creditsByDayProduct.get(row.day) ?? { chat: 0, cod: 0 };
          if (product === Product.CHATGPT) agg.chat += row.credits_total;
          else agg.cod += row.credits_total;
          creditsByDayProduct.set(row.day, agg);
        }
      }

      if (filesDownloaded >= maxFiles) break;
      if (list.has_more !== true || !list.last_end_time) break;
      cursor = list.last_end_time;
    }
  } catch (err) {
    console.error("[f1/unified-credits-live] COSTS fetch failed", err);
    return null;
  }

  if (creditsByDayProduct.size === 0) return null;

  const unifiedChatByYmd = new Map<string, number>();
  const unifiedCodByYmd = new Map<string, number>();
  let chatgptCredits = 0;
  let codexCredits = 0;

  for (const [ymd, agg] of creditsByDayProduct) {
    if (agg.chat > 0) {
      unifiedChatByYmd.set(ymd, agg.chat * OPENAI_CREDIT_OVERAGE_USD);
      chatgptCredits += agg.chat;
    }
    if (agg.cod > 0) {
      unifiedCodByYmd.set(ymd, agg.cod * OPENAI_CREDIT_OVERAGE_USD);
      codexCredits += agg.cod;
    }
  }

  return {
    unifiedChatByYmd,
    unifiedCodByYmd,
    chatgptCredits,
    codexCredits,
    totalCredits: chatgptCredits + codexCredits,
    source: "live",
  };
}
