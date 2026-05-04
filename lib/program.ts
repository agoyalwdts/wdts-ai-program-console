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
 *   - ChatGPT + Codex (combined)    — **$157K/mo** program envelope on F1
 *                                     ({@link OPENAI_CHATGPT_CODEX_ENTITLED_SEATS} ×
 *                                     {@link OPENAI_POOLED_CREDITS_PER_USER_MONTH} planning
 *                                     line per policy). Per-product cap-sums can still
 *                                     overcommit in the ladder; F1 shows this envelope.
 *   - Claude.ai (30 seats)          — ~$25K/yr placeholder, contract finalising.
 *   - M365 Copilot (314 today)      — ~$90K/yr placeholder, EA-discounted,
 *                                     footprint under §4.6.6 rationalisation.
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
 *  pooled at the organization. Overage bills at {@link OPENAI_CREDIT_OVERAGE_USD}
 *  per credit under the WDTS contract. On F1, the **combined USD cap** uses the
 *  same numeric planning line: entitled × this value → $157K/mo at 314 × 500. */
export const OPENAI_POOLED_CREDITS_PER_USER_MONTH = 500;

/** Combined ChatGPT+Codex **program envelope** on Program Health (USD/mo). */
export const COMBINED_CHATGPT_CODEX_CAP_MONTH =
  OPENAI_CHATGPT_CODEX_ENTITLED_SEATS * OPENAI_POOLED_CREDITS_PER_USER_MONTH;

/** ChatGPT portion of the combined F1 bar: entitled × ChatGPT cap-sum ($50/mo). */
const CHATGPT_COMBINED_ENVELOPE_SLICE_USD_MONTH =
  OPENAI_CHATGPT_CODEX_ENTITLED_SEATS * CHATGPT_CAP_USD_MONTH;

/** Per-product monthly budgets the dashboard renders on F1.
 *
 *  - CURSOR is the §0 credit envelope ($500K/yr ÷ 12).
 *  - CHATGPT and CODEX split {@link COMBINED_CHATGPT_CODEX_CAP_MONTH}: ChatGPT
 *    carries the 314 × $50 cap-sum slice; Codex carries the remainder so the
 *    two tiles sum to the combined cap ($157K/mo at current policy).
 *  - CLAUDE_AI and M365_COPILOT are the §0 placeholder envelopes ÷ 12. */
export const MONTHLY_BUDGET_USD: Record<ProductKey, number> = {
  CURSOR: 41_667, // $500K / 12 (credit envelope, §4.6.1 — binding constraint is $, not seats)
  CHATGPT: CHATGPT_COMBINED_ENVELOPE_SLICE_USD_MONTH,
  CODEX: COMBINED_CHATGPT_CODEX_CAP_MONTH - CHATGPT_COMBINED_ENVELOPE_SLICE_USD_MONTH,
  CLAUDE_AI: 2_083, // ~$25K / 12 placeholder (§4.6.5)
  M365_COPILOT: 7_500, // ~$90K / 12 placeholder (§4.6.6, under review)
};

export const ANNUAL_BUDGET_USD: Record<ProductKey, number> = {
  CURSOR: 500_000,
  CHATGPT: CHATGPT_COMBINED_ENVELOPE_SLICE_USD_MONTH * 12,
  CODEX: (COMBINED_CHATGPT_CODEX_CAP_MONTH - CHATGPT_COMBINED_ENVELOPE_SLICE_USD_MONTH) * 12,
  CLAUDE_AI: 25_000,
  M365_COPILOT: 90_000,
};

/** USD charged per credit beyond the pooled monthly allocation. */
export const OPENAI_CREDIT_OVERAGE_USD = 0.04;

/** Rounded illustration for FinOps callouts (e.g. landing health page). */
export const OPENAI_ILLUSTRATIVE_CREDITS_OVER_MONTH = 350_000;

export const OPENAI_ILLUSTRATIVE_OVERAGE_CHARGE_USD_MONTH =
  OPENAI_ILLUSTRATIVE_CREDITS_OVER_MONTH * OPENAI_CREDIT_OVERAGE_USD;

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
