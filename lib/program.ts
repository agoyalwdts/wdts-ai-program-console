/**
 * Program-level constants.
 *
 * Source of truth: Executive_Policy_and_Guardrails.md §0 (footprint table)
 * and §4.6 (license inventory) in agoyalwdts/wdts-ai-policy — currently at
 * commit b9342e3, document version 2.3. The numbers below are pinned to
 * that version; bump the commit fingerprint in this docstring whenever the
 * constants are re-synced. Numbers are scaled down for the v0.2 30-user
 * prototype where they involve user counts.
 *
 * The four §0 budget envelopes the dashboard renders on F1:
 *   - Cursor                        — **$500K/yr credit envelope** ($41,667/mo).
 *                                     Vendor confirmed (April 2026) that Cursor
 *                                     licenses are uncapped within this envelope;
 *                                     the binding constraint is the dollar amount,
 *                                     NOT a seat count. The 120-seat shape below
 *                                     is the WDTS allocation plan that fits
 *                                     ~$496.8K inside the $500K envelope.
 *   - ChatGPT + Codex (combined)    — $150K/mo operating envelope → $1.8M/yr.
 *                                     Per-product cap-sums intentionally
 *                                     overcommit this envelope (v2.3 expansion
 *                                     puts cap-sum at ~$225K/mo, 50% over)
 *                                     because aggregate utilisation stays inside.
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

/** Per-product monthly budgets the dashboard renders on F1.
 *
 *  - CURSOR is the §0 credit envelope ($500K/yr ÷ 12).
 *  - CHATGPT and CODEX are the dashboard's *visualisation split* of the
 *    $150K/mo combined ChatGPT+Codex operating envelope (CHATGPT carries the
 *    full 314 × $50 cap-sum; CODEX carries the residual share). NOT the
 *    per-product cap-sum — the v2.3 Codex cap-sum is ~$209K/mo, intentionally
 *    over the envelope; F1 surfaces the operating reality, not the overcommit
 *    math. The combined $150K cap is rendered as its own callout via
 *    COMBINED_CHATGPT_CODEX_CAP_MONTH.
 *  - CLAUDE_AI and M365_COPILOT are the §0 placeholder envelopes ÷ 12. */
export const MONTHLY_BUDGET_USD: Record<ProductKey, number> = {
  CURSOR: 41_667, // $500K / 12 (credit envelope, §4.6.1 — binding constraint is $, not seats)
  CHATGPT: 15_700, // 314 × $50/mo cap (§4.6.2)
  CODEX: 134_300, // residual share of the $150K combined envelope after ChatGPT
  CLAUDE_AI: 2_083, // ~$25K / 12 placeholder (§4.6.5)
  M365_COPILOT: 7_500, // ~$90K / 12 placeholder (§4.6.6, under review)
};

export const ANNUAL_BUDGET_USD: Record<ProductKey, number> = {
  CURSOR: 500_000,
  CHATGPT: 188_400,
  CODEX: 1_611_600,
  CLAUDE_AI: 25_000,
  M365_COPILOT: 90_000,
};

export const COMBINED_CHATGPT_CODEX_CAP_MONTH = 150_000;

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

export const CHATGPT_CAP_USD_MONTH = 50;
export const CLAUDE_CAP_USD_MONTH = 100;
