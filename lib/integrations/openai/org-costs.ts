/**
 * OpenAI Organization Costs API — daily buckets with optional line_item grouping.
 *
 * GET https://api.openai.com/v1/organization/costs
 * Auth: Bearer admin key + OpenAI-Organization (same as {@link ./real.ts}).
 *
 * Pagination: response may include `next_page`; pass as query `page` on the next GET.
 * Ref: OpenAI usage/cost notebooks (organization/costs + group_by line_item).
 */

import { Product } from "@prisma/client";
import { jsonGet, type Fetch } from "../_http";
import { IntegrationError } from "../errors";
import type { CostLineItemClassifier, OpenAiCostProduct } from "./cost-line-item";

export const OPENAI_ORG_COSTS_VENDOR_KEY = "OPENAI_ORG_COSTS_API" as const;

const API_BASE = "https://api.openai.com/v1";
const COSTS_PATH = `${API_BASE}/organization/costs`;

export type OpenAiCostsEnv = {
  apiKey: string;
  orgId: string;
};

export function resolveOpenAiCostsCredentials(
  env: Record<string, string | undefined> = process.env,
): OpenAiCostsEnv | null {
  const apiKey = env.OPENAI_ADMIN_API_KEY;
  const orgId = env.OPENAI_ORG_ID;
  if (!apiKey?.trim() || !orgId?.trim()) return null;
  return { apiKey, orgId };
}

function authHeaders(creds: OpenAiCostsEnv): Record<string, string> {
  return {
    Authorization: `Bearer ${creds.apiKey}`,
    "OpenAI-Organization": creds.orgId,
  };
}

type CostsPage = {
  data?: CostBucket[];
  next_page?: string | null;
};

type CostBucket = {
  start_time: number;
  end_time: number;
  results?: Array<{
    amount?: { value?: number; currency?: string };
    line_item?: string | null;
  }>;
};

export type LocalDayProductSpend = {
  spendUsd: number;
  eventCount: number;
};

/**
 * Per local-calendar day (YYYY-MM-DD), aggregated CHATGPT vs CODEX USD and row counts.
 */
export type OpenAiCostsByLocalDay = Map<
  string,
  Record<OpenAiCostProduct, LocalDayProductSpend>
>;

function emptyDay(): Record<OpenAiCostProduct, LocalDayProductSpend> {
  return {
    [Product.CHATGPT]: { spendUsd: 0, eventCount: 0 },
    [Product.CODEX]: { spendUsd: 0, eventCount: 0 },
  };
}

function addSpend(
  day: Record<OpenAiCostProduct, LocalDayProductSpend>,
  product: OpenAiCostProduct,
  usd: number,
  rows: number,
): void {
  const b = day[product];
  b.spendUsd += usd;
  b.eventCount += rows;
}

/**
 * Fetch all pages of cost buckets for [startTimeSec, endTimeSec], then bucket by
 * local calendar day and product (ChatGPT vs Codex) using {@link CostLineItemClassifier}.
 */
export type OpenAiCostsFetchResult = {
  byDay: OpenAiCostsByLocalDay;
  /** Non-zero USD cost rows from the API (before ChatGPT/Codex split). */
  sourceCostLines: number;
};

/** Default timeout for organization/costs (large orgs + line_item pagination). */
const OPENAI_ORG_COSTS_TIMEOUT_MS = 60_000;

export async function fetchOpenAiOrgCostsByLocalDay(args: {
  startTimeSec: number;
  endTimeSec: number;
  creds: OpenAiCostsEnv;
  classifier: CostLineItemClassifier;
  /** Local YYYY-MM-DD from a UTC ms instant (same semantics as F1 cursor vendor). */
  toLocalYmd: (utcMs: number) => string;
  fetchImpl?: Fetch;
  maxPages?: number;
}): Promise<OpenAiCostsFetchResult> {
  const headers = authHeaders(args.creds);
  const base = new URLSearchParams();
  base.set("start_time", String(args.startTimeSec));
  base.set("end_time", String(args.endTimeSec));
  base.set("bucket_width", "1d");
  base.set("limit", "180");
  base.append("group_by", "line_item");

  const maxPages = args.maxPages ?? 50;
  const buckets: CostBucket[] = [];
  let pageCursor: string | null | undefined = undefined;

  for (let i = 0; i < maxPages; i++) {
    const params = new URLSearchParams(base);
    if (pageCursor) params.set("page", pageCursor);
    const url = `${COSTS_PATH}?${params.toString()}`;
    const body = await jsonGet<CostsPage>(url, {
      integration: "openai",
      headers,
      fetchImpl: args.fetchImpl,
      timeoutMs: OPENAI_ORG_COSTS_TIMEOUT_MS,
    });
    const chunk = body.data ?? [];
    buckets.push(...chunk);
    pageCursor = body.next_page ?? null;
    if (!pageCursor) break;
  }
  if (pageCursor) {
    throw new IntegrationError(
      "openai",
      `organization/costs: exceeded maxPages=${maxPages} (pagination not exhausted)`,
    );
  }

  const out: OpenAiCostsByLocalDay = new Map();
  let sourceCostLines = 0;

  for (const bucket of buckets) {
    const ymd = args.toLocalYmd(bucket.start_time * 1000);
    let day = out.get(ymd);
    if (!day) {
      day = emptyDay();
      out.set(ymd, day);
    }
    for (const row of bucket.results ?? []) {
      const raw = row.amount?.value ?? 0;
      const usd = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
      if (usd === 0) continue;
      sourceCostLines += 1;
      const targets = args.classifier.allocate(row.line_item ?? null, usd);
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i]!;
        // One upstream line → one eventCount on the primary bucket; ratio splits
        // attribute spend across two products without double-counting lines.
        const rowCredit = targets.length === 1 || i === 0 ? 1 : 0;
        addSpend(day, t.product, t.usd, rowCredit);
      }
    }
  }

  return { byDay: out, sourceCostLines };
}
