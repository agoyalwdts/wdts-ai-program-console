/**
 * Program-level constants.
 *
 * Source of truth: Executive_Policy_and_Guardrails.md (footprint + license
 * inventory) in agoyalwdts/wdts-ai-policy. Re-sync when policy changes;
 * OpenAI entitled/allotted counts live on {@link OPENAI_CHATGPT_CODEX_ENTITLED_SEATS}
 * and {@link OPENAI_CHATGPT_CODEX_LICENSES_ALLOTTED}. Older doc pin: commit b9342e3,
 * v2.3 for tier math. Numbers are scaled down for the v0.2 30-user prototype
 * where they involve user counts (seed only).
 *
 * The four §0 budget envelopes the dashboard renders on F1:
 *   - Cursor                        — **$500K/yr credit envelope** ($41,667/mo).
 *                                     Vendor confirmed (April 2026) that Cursor
 *                                     licenses are uncapped within this envelope;
 *                                     the binding constraint is the dollar amount,
 *                                     NOT a seat count. The 120-seat shape below
 *                                     is the WDTS allocation plan that fits
 *                                     ~$496.8K inside the $500K envelope.
 *   - ChatGPT + Codex (combined)    — **314** entitled seats, **500** pooled credits per seat per month
 *                                     (= {@link OPENAI_POOLED_CREDITS_MONTH} monthly), **$35** per seat per month
 *                                     license baseline ({@link OPENAI_POOLED_BASELINE_USD_MONTH} monthly),
 *                                     plus ~{@link OPENAI_AVERAGE_OVERAGE_CREDITS_MONTH} overage credits per month
 *                                     at {@link OPENAI_CREDIT_OVERAGE_USD} per credit. Planning envelope
 *                                     {@link OPENAI_COMBINED_MONTHLY_PLANNING_USD} monthly (~$300K per year).
 *   - Claude.ai (30 seats)          — ~$25K/yr placeholder, contract finalising.
 *   - M365 Copilot (440 seats)      — EA prepaid annual commit (per-license
 *                                     × entitled count), not usage-metered.
 */

export type ProductKey = "CURSOR" | "CHATGPT" | "CODEX" | "CLAUDE_AI" | "M365_COPILOT";

export const PRODUCTS: { key: ProductKey; label: string }[] = [
  { key: "CURSOR", label: "Cursor" },
  { key: "CHATGPT", label: "ChatGPT" },
  { key: "CODEX", label: "Codex" },
  { key: "CLAUDE_AI", label: "Claude.ai" },
  { key: "M365_COPILOT", label: "M365 Copilot" },
];

/** ChatGPT per-user monthly cap (policy ladder); used for the ChatGPT **slice**
 *  of the combined F1 envelope. */
export const CHATGPT_CAP_USD_MONTH = 50;

/** OpenAI Enterprise (ChatGPT + Codex) entitled headcount the **credit pool**
 *  is sized for (wdts-ai-policy license inventory). Pool = entitled ×
 *  {@link OPENAI_POOLED_CREDITS_PER_USER_MONTH} credits/month, org-wide. */
export const OPENAI_CHATGPT_CODEX_ENTITLED_SEATS = 314;

/** ChatGPT + Codex licenses **currently assigned** (may be below entitled until
 *  full rollout). */
export const OPENAI_CHATGPT_CODEX_LICENSES_ALLOTTED = 304;

/** OpenAI Enterprise (ChatGPT + Codex): credits per entitled user per month,
 *  pooled at the organization. */
export const OPENAI_POOLED_CREDITS_PER_USER_MONTH = 500;

/** Monthly license line per entitled seat (pool included in subscription). */
export const OPENAI_LICENSE_USD_PER_SEAT_MONTH = 35;

/** Pooled monthly credits across entitled seats. */
export const OPENAI_POOLED_CREDITS_MONTH =
  OPENAI_CHATGPT_CODEX_ENTITLED_SEATS * OPENAI_POOLED_CREDITS_PER_USER_MONTH;

/** Fixed monthly USD for the pooled credit entitlement (314 × $35). */
export const OPENAI_POOLED_BASELINE_USD_MONTH =
  OPENAI_CHATGPT_CODEX_ENTITLED_SEATS * OPENAI_LICENSE_USD_PER_SEAT_MONTH;

/** M365 Copilot: entitled (paid) seat count — annual commit = × {@link M365_COPILOT_USD_PER_LICENSE_YEAR}. */
export const M365_COPILOT_LICENSES_ENTITLED = 440;

/** Per-seat annual contract line (USD); full commit is paid regardless of usage. */
export const M365_COPILOT_USD_PER_LICENSE_YEAR = 285.476;

/** Total annual Microsoft 365 Copilot commit (440 × per-license year). */
export const M365_COPILOT_ANNUAL_COMMIT_USD =
  M365_COPILOT_LICENSES_ENTITLED * M365_COPILOT_USD_PER_LICENSE_YEAR;

/** Level monthly budget for F1 Copilot tile (= annual ÷ 12). */
export const M365_COPILOT_MONTHLY_COMMIT_USD = M365_COPILOT_ANNUAL_COMMIT_USD / 12;

/** Typical additional monthly credits beyond pooled entitlement (planning average). */
export const OPENAI_AVERAGE_OVERAGE_CREDITS_MONTH = 200_000;

/** Planning envelope in credits/month (pooled + typical overage). */
export const OPENAI_TARGET_CREDITS_MONTH =
  OPENAI_POOLED_CREDITS_MONTH + OPENAI_AVERAGE_OVERAGE_CREDITS_MONTH;

/** USD per credit for usage above the pooled allocation (marginal / overage). */
export const OPENAI_CREDIT_OVERAGE_USD = 0.07;

/** Typical monthly overage charge at {@link OPENAI_CREDIT_OVERAGE_USD} (200k × rate). */
export const OPENAI_PLANNED_OVERAGE_USD_MONTH =
  OPENAI_AVERAGE_OVERAGE_CREDITS_MONTH * OPENAI_CREDIT_OVERAGE_USD;

/** Combined ChatGPT+Codex monthly planning envelope: license baseline + typical overage. */
export const OPENAI_COMBINED_MONTHLY_PLANNING_USD =
  OPENAI_POOLED_BASELINE_USD_MONTH + OPENAI_PLANNED_OVERAGE_USD_MONTH;

/** Annual license baseline (pool). */
export const OPENAI_ANNUAL_BASELINE_USD = OPENAI_POOLED_BASELINE_USD_MONTH * 12;

/** Annual typical overage (200k credits/mo × 12 × rate). */
export const OPENAI_ANNUAL_PLANNED_OVERAGE_USD = OPENAI_PLANNED_OVERAGE_USD_MONTH * 12;

/**
 * Combined monthly USD cap used for F1 ChatGPT/Codex tiles and Settings (baseline + planned overage).
 * @deprecated Prefer {@link OPENAI_COMBINED_MONTHLY_PLANNING_USD} — kept as alias for imports.
 */
export const COMBINED_CHATGPT_CODEX_CAP_MONTH = OPENAI_COMBINED_MONTHLY_PLANNING_USD;

/**
 * Estimate org-wide ChatGPT+Codex "credit-like" usage for a period from observed USD:
 * below baseline spend → scale within pool; above baseline → pool + overage credits at marginal rate.
 */
export function openAiCombinedCreditsUsedEstimate(args: {
  periodSpendUsd: number;
  budgetMonthMultiplier: number;
}): number {
  const m = Math.max(0, args.budgetMonthMultiplier);
  const poolCredits = OPENAI_POOLED_CREDITS_MONTH * m;
  const baselineUsd = OPENAI_POOLED_BASELINE_USD_MONTH * m;
  const usd = Math.max(0, args.periodSpendUsd);
  if (baselineUsd <= 0) return usd / OPENAI_CREDIT_OVERAGE_USD;
  if (usd <= baselineUsd) return poolCredits * (usd / baselineUsd);
  return poolCredits + (usd - baselineUsd) / OPENAI_CREDIT_OVERAGE_USD;
}

/** Per-product monthly budgets the dashboard renders on F1.
 *
 *  - CURSOR is the §0 credit envelope ($500K/yr ÷ 12).
 *  - CHATGPT and CODEX share {@link OPENAI_COMBINED_MONTHLY_PLANNING_USD}; per-product
 *    USD budgets use ChatGPT:Codex = 1:3. Credit bars use the same ratio on
 *    {@link OPENAI_TARGET_CREDITS_MONTH}.
 *  - CLAUDE_AI is the §0 placeholder envelope ÷ 12.
 *  - M365_COPILOT is the EA prepaid annual commit ÷ 12 ({@link M365_COPILOT_LICENSES_ENTITLED} × {@link M365_COPILOT_USD_PER_LICENSE_YEAR}). */
const OPENAI_CARD_WEIGHT_CHATGPT = 1;
const OPENAI_CARD_WEIGHT_CODEX = 3;
const OPENAI_CARD_WEIGHT_SUM = OPENAI_CARD_WEIGHT_CHATGPT + OPENAI_CARD_WEIGHT_CODEX;

export const MONTHLY_BUDGET_USD: Record<ProductKey, number> = {
  CURSOR: 41_667, // $500K / 12 (credit envelope, §4.6.1 — binding constraint is $, not seats)
  CHATGPT:
    OPENAI_COMBINED_MONTHLY_PLANNING_USD *
    (OPENAI_CARD_WEIGHT_CHATGPT / OPENAI_CARD_WEIGHT_SUM),
  CODEX:
    OPENAI_COMBINED_MONTHLY_PLANNING_USD *
    (OPENAI_CARD_WEIGHT_CODEX / OPENAI_CARD_WEIGHT_SUM),
  CLAUDE_AI: 2_083, // ~$25K / 12 placeholder (§4.6.5)
  M365_COPILOT: M365_COPILOT_MONTHLY_COMMIT_USD,
};

export const ANNUAL_BUDGET_USD: Record<ProductKey, number> = {
  CURSOR: 500_000,
  CHATGPT: MONTHLY_BUDGET_USD.CHATGPT * 12,
  CODEX: MONTHLY_BUDGET_USD.CODEX * 12,
  CLAUDE_AI: 25_000,
  M365_COPILOT: M365_COPILOT_ANNUAL_COMMIT_USD,
};

/** Sum of F1 monthly planning envelopes: Cursor + ChatGPT/Codex (once) + Claude + M365 Copilot. */
export const PROGRAM_MONTHLY_PLANNING_USD_TOTAL =
  MONTHLY_BUDGET_USD.CURSOR +
  OPENAI_COMBINED_MONTHLY_PLANNING_USD +
  MONTHLY_BUDGET_USD.CLAUDE_AI +
  MONTHLY_BUDGET_USD.M365_COPILOT;

/** Annual planning total for the same four pillars (matches {@link ANNUAL_BUDGET_USD} aggregation). */
export const PROGRAM_ANNUAL_PLANNING_USD_TOTAL =
  ANNUAL_BUDGET_USD.CURSOR +
  OPENAI_COMBINED_MONTHLY_PLANNING_USD * 12 +
  ANNUAL_BUDGET_USD.CLAUDE_AI +
  ANNUAL_BUDGET_USD.M365_COPILOT;

/** Illustration anchor = full planning credit envelope (pooled + typical overage). */
export const OPENAI_ILLUSTRATIVE_CREDITS_OVER_MONTH = OPENAI_TARGET_CREDITS_MONTH;

export const OPENAI_ILLUSTRATIVE_OVERAGE_CHARGE_USD_MONTH =
  OPENAI_AVERAGE_OVERAGE_CREDITS_MONTH * OPENAI_CREDIT_OVERAGE_USD;

/** Cursor sub-tiers (§4.6.1, four-sub-tier shape introduced in v2.0 and
 *  carried unchanged through v2.3). Discovery is the $50/mo floor of the
 *  promotion ladder (Discovery → Light → Standard → Power), parallel to
 *  Codex Discovery. The cap-sum across all four tiers
 *  (17·900 + 42·400 + 25·300 + 36·50 = $41,400/mo, ~$496,800/yr) sits
 *  *inside* the $500K credit envelope — no overcommit, the §4.6.4
 *  dormancy/reclamation flow is the headroom mechanism. */
export const CURSOR_TIERS = {
  POWER: { label: "Power", capUsdMonth: 900, color: "violet" as const },
  STANDARD: { label: "Standard", capUsdMonth: 400, color: "blue" as const },
  LIGHT: { label: "Light", capUsdMonth: 300, color: "slate" as const },
  DISCOVERY: { label: "Discovery", capUsdMonth: 50, color: "stone" as const },
};

/** Cursor seat distribution per §4.6.1 (v2.0+ shape, current at v2.3) —
 *  120 seats across four sub-tiers (was 84 across three in v1.x). Vendor
 *  confirmed (April 2026) that licenses are uncapped within the $500K
 *  envelope, so these numbers are an *allocation plan* not a
 *  vendor-imposed cap. */
export const CURSOR_SEATS = {
  POWER: 17,
  STANDARD: 42,
  LIGHT: 25,
  DISCOVERY: 36,
} as const;
export const CURSOR_TOTAL_SEATS =
  CURSOR_SEATS.POWER +
  CURSOR_SEATS.STANDARD +
  CURSOR_SEATS.LIGHT +
  CURSOR_SEATS.DISCOVERY; // 120

/** Codex sub-tiers (§4.6.2, v2.3 expansion).
 *  Active footprint 150 (Power 18 / Standard 50 / Light 82) plus 164
 *  Discovery — every other ChatGPT user gets a $75/mo Codex floor.
 *  The dashboard does not currently store the seat-count distribution for
 *  Codex (only the caps); seed counts are scaled to the 30-user prototype. */
export const CODEX_TIERS = {
  POWER: { label: "Power", capUsdMonth: 2500 },
  STANDARD: { label: "Standard", capUsdMonth: 1400 },
  LIGHT: { label: "Light", capUsdMonth: 1000 },
  DISCOVERY: { label: "Discovery", capUsdMonth: 75 },
};

export const CLAUDE_CAP_USD_MONTH = 100;
