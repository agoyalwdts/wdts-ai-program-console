/**
 * F9 / listCodexSeats — per-seat MTD and last activity from Codex Enterprise Analytics
 * when INTEGRATION_CODEX_ENTERPRISE_ANALYTICS=real (api.chatgpt.com per-user usage).
 */

import type { CodexSeat } from "@/lib/integrations/openai/types";
import { getIntegrationMode } from "@/lib/integrations/env";
import { openAiBillingPeriodStartSec } from "@/lib/openai-billing-period";
import {
  aggregateLastActivityEndSecByNormEmail,
  aggregateMtdCreditsByNormEmail,
  normCodexAnalyticsEmail,
} from "./aggregate-per-user-mtd";
import {
  fetchCodexEnterprisePerUserUsageRows,
  resolveCodexEnterpriseAnalyticsCredentials,
  resolveUsdPerCredit,
} from "./fetch-workspace-usage";
import type { Fetch } from "../_http";

const LOOKBACK_DAYS = 90;

export async function enrichCodexSeatsFromEnterpriseAnalytics(
  seats: CodexSeat[],
  opts?: {
    env?: Record<string, string | undefined>;
    fetchImpl?: Fetch;
    now?: Date;
  },
): Promise<CodexSeat[]> {
  const env = opts?.env ?? process.env;
  if (getIntegrationMode("codexenterprise", env) !== "real") return seats;
  const creds = resolveCodexEnterpriseAnalyticsCredentials(env);
  if (!creds) return seats;

  const now = opts?.now ?? new Date();
  const monthStartSec = openAiBillingPeriodStartSec(now);
  const endSec = Math.floor(now.getTime() / 1000);
  const lookbackStartSec = endSec - LOOKBACK_DAYS * 86_400;

  try {
    const rows = await fetchCodexEnterprisePerUserUsageRows({
      startTimeSec: lookbackStartSec,
      endTimeSec: endSec,
      creds,
      fetchImpl: opts?.fetchImpl,
    });
    const usdPerCredit = resolveUsdPerCredit(env);
    const mtdCredits = aggregateMtdCreditsByNormEmail({
      rows,
      monthStartSec,
      endSec,
    });
    const lastEndSec = aggregateLastActivityEndSecByNormEmail(rows);

    return seats.map((s) => {
      const key = normCodexAnalyticsEmail(s.email);
      const credits = mtdCredits.get(key);
      if (credits == null) return s;

      const mtdSpendUsd = credits * usdPerCredit;
      const lastSec = lastEndSec.get(key);
      const lastActivityTs =
        lastSec != null ? new Date(lastSec * 1000) : s.lastActivityTs;
      const idleDays =
        lastActivityTs != null
          ? Math.max(
              0,
              Math.floor(
                (now.getTime() - lastActivityTs.getTime()) / (24 * 60 * 60 * 1000),
              ),
            )
          : s.idleDays;

      return {
        ...s,
        mtdSpendUsd,
        lastActivityTs,
        idleDays,
      };
    });
  } catch (err) {
    console.error(
      "[codexenterprise] enrichCodexSeatsFromEnterpriseAnalytics failed; keeping gateway/Prisma MTD",
      err,
    );
    return seats;
  }
}
