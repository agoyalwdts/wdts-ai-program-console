/**
 * Map LiteLLM Proxy `StandardLoggingPayload` (generic_api webhook) into
 * the dashboard's usage-ingest event shape.
 *
 * Operator guidelines: docs/gateway-and-litellm.md
 *
 * Ref: https://litellm.vercel.app/docs/observability/generic_api
 * Ref: https://docs.litellm.ai/docs/proxy/logging_spec
 *
 * Clients should pass `metadata` keys the dashboard recognises, e.g.:
 *   - `user_email` or `wdts_user_email` (required for User row join), e.g.
 *     `agoyal@wdtablesystems.com`
 *   - optional `wdts_product` — one of Product enum strings; else
 *     `LITELLM_DEFAULT_PRODUCT` env (defaults to CHATGPT)
 *   - optional `wdts_region` — else `LITELLM_DEFAULT_REGION` or "global"
 *
 * **Cursor vs OpenAI (same LiteLLM proxy):** when `wdts_product` is not set,
 * the normaliser can infer **`CURSOR`** from LiteLLM fields Cursor typically
 * populates: `request_tags` (`cursor`, `wdts:cursor`), `requester_custom_headers`
 * User-Agent containing `Cursor`, or `api_base` / `hidden_params.api_base`
 * pointing at `cursor.com` / `cursor.sh`. Set `LITELLM_INFER_CURSOR_PRODUCT=0`
 * to disable inference and rely only on explicit `wdts_product`.
 *
 * Prompt/response bodies are never read for persistence.
 */

import type { Product, UsageDecision } from "@prisma/client";

const PRODUCT_VALUES = new Set<string>([
  "CHATGPT",
  "CODEX",
  "CURSOR",
  "CLAUDE_AI",
  "M365_COPILOT",
]);

export type LiteLLmIngestDefaults = {
  defaultProduct: Product;
  defaultRegion: string;
  /**
   * When true (default), infer `Product.CURSOR` from tags / User-Agent /
   * Cursor API base if `wdts_product` is absent. Set false when every row
   * must declare `metadata.wdts_product` explicitly.
   */
  inferCursorProduct: boolean;
};

export type LiteLLmNormalizedEvent = {
  sourceEventId: string;
  userEmail: string;
  product: Product;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  decision: UsageDecision;
  region: string;
  ts: string;
  dlpLayersHit: string[];
};

export type LiteLLmNormalizeResult =
  | { ok: true; event: LiteLLmNormalizedEvent }
  | { ok: false; reason: string };

function pickEmail(meta: Record<string, unknown>, endUser: unknown): string | null {
  const spend = meta.spend_logs_metadata;
  if (spend && typeof spend === "object") {
    const s = spend as Record<string, unknown>;
    for (const k of ["user_email", "wdts_user_email", "email"]) {
      const v = s[k];
      if (typeof v === "string" && v.includes("@")) return v.trim().toLowerCase();
    }
  }
  for (const k of ["user_email", "wdts_user_email", "user_email"]) {
    const v = meta[k];
    if (typeof v === "string" && v.includes("@")) return v.trim().toLowerCase();
  }
  const uid = meta.user_api_key_user_id;
  if (typeof uid === "string" && uid.includes("@")) return uid.trim().toLowerCase();
  if (typeof endUser === "string" && endUser.includes("@")) return endUser.trim().toLowerCase();
  return null;
}

function readApiBase(o: Record<string, unknown>): string {
  const top = o.api_base;
  if (typeof top === "string" && top.trim()) return top.trim();
  const hp = o.hidden_params;
  if (hp && typeof hp === "object") {
    const b = (hp as Record<string, unknown>).api_base;
    if (typeof b === "string" && b.trim()) return b.trim();
  }
  return "";
}

/**
 * When LiteLLM fronts OpenAI for both ChatGPT-shaped and Cursor IDE traffic,
 * infer CURSOR from common LiteLLM payload signals (explicit wdts_product wins).
 */
function inferCursorFromLiteLLmSignals(
  o: Record<string, unknown>,
  meta: Record<string, unknown>,
): boolean {
  const apiBase = readApiBase(o);
  if (apiBase && /cursor\.(com|sh)\b/i.test(apiBase)) return true;

  const headers = meta.requester_custom_headers;
  if (headers && typeof headers === "object") {
    const h = headers as Record<string, unknown>;
    for (const [key, val] of Object.entries(h)) {
      const kl = key.toLowerCase();
      if (kl !== "user-agent" && !kl.startsWith("x-")) continue;
      if (typeof val === "string" && /\bCursor\b/i.test(val)) return true;
    }
  }

  const tags = o.request_tags;
  if (Array.isArray(tags)) {
    for (const t of tags) {
      if (typeof t !== "string") continue;
      const s = t.trim().toLowerCase();
      if (s === "cursor" || s === "wdts:cursor" || s.startsWith("cursor:")) {
        return true;
      }
    }
  }

  const rm = meta.requester_metadata;
  if (rm && typeof rm === "object") {
    const src = (rm as Record<string, unknown>).wdts_client;
    if (typeof src === "string" && src.trim().toLowerCase() === "cursor") {
      return true;
    }
  }

  return false;
}

function pickProduct(
  o: Record<string, unknown>,
  meta: Record<string, unknown>,
  defaults: LiteLLmIngestDefaults,
): Product {
  const v = meta.wdts_product;
  if (typeof v === "string" && PRODUCT_VALUES.has(v)) {
    return v as Product;
  }
  const spend = meta.spend_logs_metadata;
  if (spend && typeof spend === "object") {
    const wp = (spend as Record<string, unknown>).wdts_product;
    if (typeof wp === "string" && PRODUCT_VALUES.has(wp)) {
      return wp as Product;
    }
  }
  if (defaults.inferCursorProduct && inferCursorFromLiteLLmSignals(o, meta)) {
    return "CURSOR";
  }
  return defaults.defaultProduct;
}

function pickRegion(meta: Record<string, unknown>, defaults: LiteLLmIngestDefaults): string {
  const v = meta.wdts_region;
  if (typeof v === "string" && v.trim()) return v.trim();
  return defaults.defaultRegion;
}

function parseTime(v: unknown): Date | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    if (v > 1_000_000_000_000) return new Date(v);
    if (v > 10_000_000_000) return new Date(v);
    return new Date(v * 1000);
  }
  return null;
}

function pickCost(o: Record<string, unknown>): number | null {
  const rc = o.response_cost;
  if (typeof rc === "number" && Number.isFinite(rc) && rc >= 0) return rc;
  const c = o.cost;
  if (typeof c === "number" && Number.isFinite(c) && c >= 0) return c;
  const cb = o.cost_breakdown;
  if (cb && typeof cb === "object") {
    const t = (cb as Record<string, unknown>).total_cost;
    if (typeof t === "number" && Number.isFinite(t) && t >= 0) return t;
  }
  return null;
}

function pickTokens(o: Record<string, unknown>): { in: number | null; out: number | null } {
  let tin: number | null = null;
  let tout: number | null = null;
  const pt = o.prompt_tokens;
  const ct = o.completion_tokens;
  if (typeof pt === "number" && Number.isFinite(pt) && pt >= 0) tin = Math.floor(pt);
  if (typeof ct === "number" && Number.isFinite(ct) && ct >= 0) tout = Math.floor(ct);
  const usage = o.usage;
  if (usage && typeof usage === "object") {
    const u = usage as Record<string, unknown>;
    const pi = u.prompt_tokens;
    const co = u.completion_tokens;
    if (typeof pi === "number" && Number.isFinite(pi) && pi >= 0) tin = Math.floor(pi);
    if (typeof co === "number" && Number.isFinite(co) && co >= 0) tout = Math.floor(co);
  }
  return { in: tin, out: tout };
}

function pickDecision(o: Record<string, unknown>): UsageDecision {
  const status = o.status;
  if (status === "failure") return "BLOCKED";
  const sf = o.status_fields;
  if (sf && typeof sf === "object") {
    const llm = (sf as Record<string, unknown>).llm_api_status;
    if (llm === "failure") return "BLOCKED";
    const gs = (sf as Record<string, unknown>).guardrail_status;
    if (gs === "guardrail_intervened") return "BLOCKED";
  }
  if (typeof o.error_str === "string" && o.error_str.trim()) return "BLOCKED";
  return "ALLOWED";
}

function pickGuardrails(o: Record<string, unknown>): string[] {
  const g = o.applied_guardrails;
  if (!Array.isArray(g)) return [];
  const names: string[] = [];
  for (const x of g) {
    if (typeof x === "string") names.push(x);
    else if (x && typeof x === "object" && typeof (x as { name?: string }).name === "string") {
      names.push((x as { name: string }).name);
    }
  }
  return names;
}

/**
 * Normalise one LiteLLM log object. Does not touch Prisma.
 */
export function normalizeLiteLLmLogRow(
  row: unknown,
  defaults: LiteLLmIngestDefaults,
): LiteLLmNormalizeResult {
  if (!row || typeof row !== "object") {
    return { ok: false, reason: "log row must be an object" };
  }
  const o = row as Record<string, unknown>;
  const id = o.id;
  if (typeof id !== "string" || !id.trim()) {
    return { ok: false, reason: "missing string id" };
  }
  const sourceEventId = `litellm:${id.trim()}`;

  const model = o.model;
  if (typeof model !== "string" || !model.trim()) {
    return { ok: false, reason: "missing model" };
  }

  const meta =
    o.metadata && typeof o.metadata === "object"
      ? (o.metadata as Record<string, unknown>)
      : {};

  const email = pickEmail(meta, o.end_user);
  if (!email) {
    return {
      ok: false,
      reason:
        "could not resolve user email (set metadata.user_email / wdts_user_email / spend_logs_metadata.user_email, or end_user to an email)",
    };
  }

  const ts =
    parseTime(o.endTime) ??
    parseTime(o.startTime) ??
    parseTime(o.completionStartTime);
  if (!ts) {
    return { ok: false, reason: "could not parse endTime/startTime" };
  }

  const tokens = pickTokens(o);
  const costUsd = pickCost(o);

  return {
    ok: true,
    event: {
      sourceEventId,
      userEmail: email,
      product: pickProduct(o, meta, defaults),
      model: model.trim(),
      tokensIn: tokens.in,
      tokensOut: tokens.out,
      costUsd,
      decision: pickDecision(o),
      region: pickRegion(meta, defaults),
      ts: ts.toISOString(),
      dlpLayersHit: pickGuardrails(o),
    },
  };
}

/**
 * Parse webhook raw body into an array of log objects.
 * Supports json_array (default), a single object, or `{ "logs": [...] }`.
 */
export function parseLiteLLmWebhookJson(body: unknown): unknown[] | { error: string } {
  if (body == null) {
    return { error: "empty body" };
  }
  if (Array.isArray(body)) {
    return body;
  }
  if (typeof body === "object") {
    const logs = (body as { logs?: unknown }).logs;
    if (Array.isArray(logs)) return logs;
    return [body];
  }
  return { error: "JSON must be an array or object" };
}
