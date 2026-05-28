/**
 * Tiny shared HTTP utility for the integration layer. Keeps each `real`
 * client small while still surfacing failures consistently as
 * `IntegrationError` instances.
 *
 * Two helpers:
 *   - `jsonGet`  — single GET → JSON. Throws on non-2xx.
 *   - `paginate` — generic walker for `?cursor=` / `after=` / `next_url`
 *                  pagination shapes. Each integration plugs its own
 *                  `extractCursor` and `extractItems`.
 *
 * Usage outside the integration layer is allowed but discouraged — UI
 * code should call the typed clients in `lib/integrations/*` instead.
 */

import { IntegrationError } from "./errors";

export type Fetch = typeof fetch;

export type JsonGetOpts = {
  fetchImpl?: Fetch;
  /** Headers to merge with whatever the helper adds. */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds (default from env or 8000). */
  timeoutMs?: number;
  /** Identifier used in IntegrationError messages — usually the
   *  IntegrationName (e.g. "openai", "anthropic"). */
  integration: string;
};

function integrationHttpTimeoutMs(override?: number): number {
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return Math.floor(override);
  }
  const raw = process.env.INTEGRATION_HTTP_TIMEOUT_MS?.trim();
  if (!raw) return 8000;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 8000;
  return parsed;
}

export async function jsonGet<T>(url: string, opts: JsonGetOpts): Promise<T> {
  const f = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = integrationHttpTimeoutMs(opts.timeoutMs);
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await f(url, {
      method: "GET",
      headers: { Accept: "application/json", ...(opts.headers ?? {}) },
      signal: ctrl.signal,
    });
  } catch (err) {
    if ((err as { name?: string } | null)?.name === "AbortError") {
      throw new IntegrationError(
        opts.integration,
        `GET ${url} timed out after ${timeoutMs}ms`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new IntegrationError(
      opts.integration,
      `GET ${url} → ${res.status} ${res.statusText}: ${text.slice(0, 500)}`,
    );
  }
  return (await res.json()) as T;
}

export type PaginateOpts<TPage, TItem> = JsonGetOpts & {
  /** Initial URL to fetch. Caller pre-builds the query string. */
  initialUrl: string;
  /** Pull the page items from a parsed page. */
  extractItems: (page: TPage) => TItem[];
  /** Return the next absolute URL, or null/undefined for "stop". */
  nextUrl: (page: TPage, currentUrl: string) => string | null | undefined;
  /** Hard cap to defend against runaway loops. Default 50. */
  maxPages?: number;
};

export async function paginate<TPage, TItem>(
  opts: PaginateOpts<TPage, TItem>,
): Promise<TItem[]> {
  const limit = opts.maxPages ?? 50;
  const out: TItem[] = [];
  let url: string | null | undefined = opts.initialUrl;
  for (let i = 0; i < limit && url; i++) {
    const page = await jsonGet<TPage>(url, opts);
    out.push(...opts.extractItems(page));
    url = opts.nextUrl(page, url);
  }
  if (url) {
    throw new IntegrationError(
      opts.integration,
      `paginate: exceeded maxPages=${limit} starting at ${opts.initialUrl}`,
    );
  }
  return out;
}
