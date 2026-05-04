/**
 * Map OpenAI cost `line_item` strings to F1 products CHATGPT vs CODEX.
 *
 * Line items are model/API-centric (e.g. "gpt-4o, input"); explicit "codex"
 * substrings are classified to CODEX; optional env overrides win first.
 * Unmapped spend is split by {@link MONTHLY_BUDGET_USD} ChatGPT vs Codex slice
 * (or forced to one product via env).
 */

import { Product } from "@prisma/client";
import { MONTHLY_BUDGET_USD } from "@/lib/program";

export type OpenAiCostProduct = Extract<Product, "CHATGPT" | "CODEX">;

export type CostAllocation = { product: OpenAiCostProduct; usd: number };

/** How to treat cost rows whose line_item does not match any rule. */
export type UnmappedSplitMode = "ratio" | "CHATGPT" | "CODEX";

export type CostLineItemClassifier = {
  allocate(lineItem: string | null, usd: number): CostAllocation[];
};

type SubstringRule = { needle: string; product: OpenAiCostProduct };

function parseSubstringRulesJson(
  raw: string | undefined,
): SubstringRule[] {
  if (!raw?.trim()) return [];
  let obj: Record<string, string>;
  try {
    obj = JSON.parse(raw) as Record<string, string>;
  } catch {
    return [];
  }
  const rules: SubstringRule[] = [];
  for (const [needle, productName] of Object.entries(obj)) {
    const n = needle.trim();
    if (!n) continue;
    const p = productName.trim().toUpperCase();
    if (p === "CODEX") rules.push({ needle: n, product: Product.CODEX });
    else if (p === "CHATGPT") rules.push({ needle: n, product: Product.CHATGPT });
  }
  return rules.sort((a, b) => b.needle.length - a.needle.length);
}

function readUnmappedMode(
  env: Record<string, string | undefined>,
): UnmappedSplitMode {
  const v = env.OPENAI_COST_UNMAPPED_SPLIT?.trim().toLowerCase();
  if (v === "chatgpt") return "CHATGPT";
  if (v === "codex") return "CODEX";
  if (v === "ratio" || v === undefined || v === "") return "ratio";
  return "ratio";
}

function defaultCodexHints(s: string): boolean {
  if (/\bcodex\b/i.test(s)) return true;
  const lower = s.toLowerCase();
  return (
    lower.includes("gpt-5.3-codex") ||
    lower.includes("o3-codex") ||
    lower.includes("o4-mini-codex")
  );
}

function defaultChatgptHints(s: string): boolean {
  return s.toLowerCase().includes("chatgpt") || s.toLowerCase().includes("chat gpt");
}

function splitByBudgetRatio(usd: number): CostAllocation[] {
  const cg = MONTHLY_BUDGET_USD.CHATGPT;
  const cx = MONTHLY_BUDGET_USD.CODEX;
  const t = cg + cx;
  if (t <= 0) {
    const half = usd / 2;
    return [
      { product: Product.CHATGPT, usd: half },
      { product: Product.CODEX, usd: half },
    ];
  }
  return [
    { product: Product.CHATGPT, usd: usd * (cg / t) },
    { product: Product.CODEX, usd: usd * (cx / t) },
  ];
}

/**
 * Build classifier from process env (or injected env in tests).
 *
 * `OPENAI_COST_LINE_ITEM_SUBSTRINGS_JSON` — JSON object mapping substring →
 * `"CHATGPT"` | `"CODEX"` (case-insensitive). Longer keys are matched first.
 *
 * `OPENAI_COST_UNMAPPED_SPLIT` — `ratio` (default), `CHATGPT`, or `CODEX`.
 */
export function buildCostLineItemClassifier(
  env: Record<string, string | undefined> = process.env,
): CostLineItemClassifier {
  const customRules = parseSubstringRulesJson(env.OPENAI_COST_LINE_ITEM_SUBSTRINGS_JSON);
  const unmapped = readUnmappedMode(env);

  return {
    allocate(lineItem: string | null, usd: number): CostAllocation[] {
      const li = lineItem?.trim() ?? "";
      if (usd <= 0) return [];

      if (li.length > 0) {
        const lower = li.toLowerCase();
        for (const r of customRules) {
          if (lower.includes(r.needle.toLowerCase())) {
            return [{ product: r.product, usd }];
          }
        }
        if (defaultCodexHints(li)) return [{ product: Product.CODEX, usd }];
        if (defaultChatgptHints(li)) return [{ product: Product.CHATGPT, usd }];
      }

      if (unmapped === "CHATGPT") return [{ product: Product.CHATGPT, usd }];
      if (unmapped === "CODEX") return [{ product: Product.CODEX, usd }];
      return splitByBudgetRatio(usd);
    },
  };
}
