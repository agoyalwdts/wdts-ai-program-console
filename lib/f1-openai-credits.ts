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
  env?: Record<string, string | undefined>;
}): OpenAiF1Credits {
  const env = args.env ?? process.env;
  const codexUsdPerCredit = resolveUsdPerCredit(env);

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
