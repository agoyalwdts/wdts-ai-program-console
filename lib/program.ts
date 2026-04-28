/**
 * Program-level constants.
 *
 * Source of truth: Executive_Policy_and_Guardrails.md §0 (footprint table)
 * and §4.6 (license inventory). Numbers are scaled-down for the v0.1
 * 30-user prototype where they involve user counts.
 *
 * The four policy budgets we render on F1:
 *   - Cursor (84 paid seats; $500K/yr commitment, $41,667/mo)
 *   - ChatGPT + Codex (combined $150K/mo cap → $1.8M/yr)
 *   - Claude.ai (~30 seats × $100/mo placeholder ≈ $25K/yr)
 *   - M365 Copilot (~$90K/yr placeholder, EA-discounted, footprint under review)
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
 *  Note: ChatGPT + Codex share a single $150K/mo cap at the program level,
 *  so we represent each separately for visualisation but flag the shared cap. */
export const MONTHLY_BUDGET_USD: Record<ProductKey, number> = {
  CURSOR: 41_667, // $500K / 12
  CHATGPT: 15_700, // §4.6.2 ChatGPT cap aggregate
  CODEX: 134_300, // §4.6.2 Codex sub-tier sum (Discovery + Light + Standard + Power)
  CLAUDE_AI: 2_083, // ~$25K / 12
  M365_COPILOT: 7_500, // ~$90K / 12 placeholder
};

export const ANNUAL_BUDGET_USD: Record<ProductKey, number> = {
  CURSOR: 500_000,
  CHATGPT: 188_400,
  CODEX: 1_611_600,
  CLAUDE_AI: 25_000,
  M365_COPILOT: 90_000,
};

export const COMBINED_CHATGPT_CODEX_CAP_MONTH = 150_000;

/** Cursor sub-tiers (§4.6.1). */
export const CURSOR_TIERS = {
  POWER: { label: "Power", capUsdMonth: 900, color: "violet" as const },
  STANDARD: { label: "Standard", capUsdMonth: 400, color: "blue" as const },
  LIGHT: { label: "Light", capUsdMonth: 300, color: "slate" as const },
};

/** Cursor seat distribution per scoping doc (matches the 84-seat board). */
export const CURSOR_SEATS = { POWER: 17, STANDARD: 42, LIGHT: 25 } as const;
export const CURSOR_TOTAL_SEATS =
  CURSOR_SEATS.POWER + CURSOR_SEATS.STANDARD + CURSOR_SEATS.LIGHT; // 84

/** Codex sub-tiers (§4.6.2). */
export const CODEX_TIERS = {
  POWER: { label: "Power", capUsdMonth: 2500 },
  STANDARD: { label: "Standard", capUsdMonth: 1400 },
  LIGHT: { label: "Light", capUsdMonth: 1000 },
  DISCOVERY: { label: "Discovery", capUsdMonth: 75 },
};

export const CHATGPT_CAP_USD_MONTH = 50;
export const CLAUDE_CAP_USD_MONTH = 100;
