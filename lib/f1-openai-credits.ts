/**
 * Per-product credit totals for F1 OpenAI tiles.
 *
 * Workspace Analytics `CHATGPT_USER_ANALYTICS` credits are org-pool totals (ChatGPT
 * app + Codex charged to the same pool). Codex Enterprise Analytics is the Codex
 * slice. ChatGPT-only = pool − Codex (not a USD-ratio split of a combined estimate).
 */

import {
  OPENAI_CREDIT_OVERAGE_USD,
  openAiCombinedCreditsUsedEstimate,
} from "@/lib/program";
import { resolveUsdPerCredit } from "@/lib/integrations/codex-enterprise-analytics/fetch-workspace-usage";
import type { OpenAiDailyMergedSpend } from "@/lib/f1-openai-daily-spend";
import { localYmd } from "@/lib/f1-cursor-vendor";

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function enumerateDays(periodStart: Date, periodEnd: Date): Date[] {
  const startDay = startOfLocalDay(periodStart);
  const endDay = startOfLocalDay(periodEnd);
  if (startDay.getTime() > endDay.getTime()) return [];
  const out: Date[] = [];
  for (let d = new Date(startDay); d.getTime() <= endDay.getTime(); d.setDate(d.getDate() + 1)) {
    out.push(new Date(d));
  }
  return out;
}

/** Workspace Analytics / manual users CSV = org pool; ChatGPT tile = pool − Codex per day. */
function isOrgPoolChatGptSource(source: string | undefined): boolean {
  return source === "workspace_analytics" || source === "manual_export";
}

/** Unified Credits and org-costs API rows carry explicit product slices. */
function isExplicitChatGptProductSource(source: string | undefined): boolean {
  return source === "unified_credits" || source === "vendor";
}

export type OpenAiF1Credits = {
  chatgptCredits: number;
  codexCredits: number;
  combinedCredits: number;
  /** direct = vendor credits; estimated = gateway / org-costs USD model */
  mode: "direct" | "estimated";
};

function usdToCredits(usd: number, usdPerCredit: number): number {
  if (usd <= 0 || usdPerCredit <= 0) return 0;
  return usd / usdPerCredit;
}

export function resolveOpenAiCreditsFromDailyMerge(args: {
  merged: OpenAiDailyMergedSpend;
  periodStart: Date;
  periodEnd: Date;
  env?: Record<string, string | undefined>;
}): OpenAiF1Credits {
  const codexUsdPerCredit = resolveUsdPerCredit(args.env ?? process.env);
  let chatgptCredits = 0;
  let codexCredits = 0;
  let combinedCredits = 0;

  for (const day of enumerateDays(args.periodStart, args.periodEnd)) {
    const ymd = localYmd(day);
    const chatgptUsd = args.merged.chatgpt.byYmd.get(ymd) ?? 0;
    const codexUsd = args.merged.codex.byYmd.get(ymd) ?? 0;
    const chatgptSource = args.merged.chatgpt.byYmdSource.get(ymd) ?? "gateway";
    const codexCr = usdToCredits(codexUsd, codexUsdPerCredit);

    if (isExplicitChatGptProductSource(chatgptSource)) {
      const chatgptCr = usdToCredits(chatgptUsd, OPENAI_CREDIT_OVERAGE_USD);
      chatgptCredits += chatgptCr;
      codexCredits += codexCr;
      combinedCredits += chatgptCr + codexCr;
    } else if (isOrgPoolChatGptSource(chatgptSource) && chatgptUsd > 0) {
      const poolCr = usdToCredits(chatgptUsd, OPENAI_CREDIT_OVERAGE_USD);
      chatgptCredits += Math.max(0, poolCr - codexCr);
      codexCredits += codexCr;
      combinedCredits += poolCr;
    } else {
      const chatgptCr = usdToCredits(chatgptUsd, OPENAI_CREDIT_OVERAGE_USD);
      chatgptCredits += chatgptCr;
      codexCredits += codexCr;
      combinedCredits += chatgptCr + codexCr;
    }
  }

  return {
    chatgptCredits,
    codexCredits,
    combinedCredits,
    mode: args.merged.chatgpt.usedVendorMirror || args.merged.codex.usedVendorMirror ? "direct" : "estimated",
  };
}

export function resolveOpenAiF1Credits(args: {
  chatgptUsd: number;
  codexUsd: number;
  budgetMonthMultiplier: number;
  workspaceChatgptUsed: boolean;
  workspaceChatgptUsd: number;
  manualChatgptUsed: boolean;
  manualChatgptUsd: number;
  codexEnterpriseUsed: boolean;
  codexEnterpriseUsd: number;
  unifiedChatgptUsed: boolean;
  unifiedChatgptUsd: number;
  unifiedCodexUsed: boolean;
  unifiedCodexUsd: number;
  /** Per-day vendor composite (Unified Credits + fallbacks by day). */
  vendorMirrorCompositeUsed?: boolean;
  env?: Record<string, string | undefined>;
}): OpenAiF1Credits {
  const env = args.env ?? process.env;
  const codexUsdPerCredit = resolveUsdPerCredit(env);

  if (args.vendorMirrorCompositeUsed) {
    // Caller should prefer resolveOpenAiCreditsFromDailyMerge — this path is a fallback.
    const orgPoolUsd =
      args.workspaceChatgptUsed
        ? args.workspaceChatgptUsd
        : args.manualChatgptUsed
          ? args.manualChatgptUsd
          : 0;
    const codexCreditsDirect = usdToCredits(args.codexUsd, codexUsdPerCredit);

    if (orgPoolUsd > 0 && codexCreditsDirect > 0 && !args.unifiedChatgptUsed) {
      const orgPoolCredits = usdToCredits(orgPoolUsd, OPENAI_CREDIT_OVERAGE_USD);
      return {
        chatgptCredits: Math.max(0, orgPoolCredits - codexCreditsDirect),
        codexCredits: codexCreditsDirect,
        combinedCredits: orgPoolCredits,
        mode: "direct",
      };
    }

    const chatgptCredits = usdToCredits(args.chatgptUsd, OPENAI_CREDIT_OVERAGE_USD);
    const codexCredits = codexCreditsDirect;
    return {
      chatgptCredits,
      codexCredits,
      combinedCredits: chatgptCredits + codexCredits,
      mode: "direct",
    };
  }

  if (args.unifiedChatgptUsed || args.unifiedCodexUsed) {
    const chatgptCredits = args.unifiedChatgptUsed
      ? usdToCredits(args.unifiedChatgptUsd, OPENAI_CREDIT_OVERAGE_USD)
      : usdToCredits(args.chatgptUsd, OPENAI_CREDIT_OVERAGE_USD);
    const codexCredits = args.unifiedCodexUsed
      ? usdToCredits(args.unifiedCodexUsd, codexUsdPerCredit)
      : 0;
    return {
      chatgptCredits,
      codexCredits,
      combinedCredits: chatgptCredits + codexCredits,
      mode: "direct",
    };
  }

  const orgPoolUsd =
    args.workspaceChatgptUsed
      ? args.workspaceChatgptUsd
      : args.manualChatgptUsed
        ? args.manualChatgptUsd
        : 0;
  const orgPoolCredits = usdToCredits(orgPoolUsd, OPENAI_CREDIT_OVERAGE_USD);

  const codexCreditsDirect = args.codexEnterpriseUsed
    ? usdToCredits(args.codexEnterpriseUsd, codexUsdPerCredit)
    : 0;

  if (orgPoolCredits > 0 && args.codexEnterpriseUsed) {
    const chatgptCredits = Math.max(0, orgPoolCredits - codexCreditsDirect);
    return {
      chatgptCredits,
      codexCredits: codexCreditsDirect,
      combinedCredits: orgPoolCredits,
      mode: "direct",
    };
  }

  if (orgPoolCredits > 0) {
    return {
      chatgptCredits: orgPoolCredits,
      codexCredits: 0,
      combinedCredits: orgPoolCredits,
      mode: "direct",
    };
  }

  if (codexCreditsDirect > 0) {
    const chatgptCredits = usdToCredits(args.chatgptUsd, OPENAI_CREDIT_OVERAGE_USD);
    return {
      chatgptCredits,
      codexCredits: codexCreditsDirect,
      combinedCredits: chatgptCredits + codexCreditsDirect,
      mode: "direct",
    };
  }

  const combinedUsd = args.chatgptUsd + args.codexUsd;
  const combinedCredits = openAiCombinedCreditsUsedEstimate({
    periodSpendUsd: combinedUsd,
    budgetMonthMultiplier: args.budgetMonthMultiplier,
  });
  if (combinedUsd <= 0) {
    return { chatgptCredits: 0, codexCredits: 0, combinedCredits: 0, mode: "estimated" };
  }
  const chatgptCredits = combinedCredits * (args.chatgptUsd / combinedUsd);
  return {
    chatgptCredits,
    codexCredits: combinedCredits - chatgptCredits,
    combinedCredits,
    mode: "estimated",
  };
}
