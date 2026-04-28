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
  /** Identifier used in IntegrationError messages — usually the
   *  IntegrationName (e.g. "openai", "anthropic"). */
  integration: string;
};

export async function jsonGet<T>(url: string, opts: JsonGetOpts): Promise<T> {
  const f = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const res = await f(url, {
    method: "GET",
    headers: { Accept: "application/json", ...(opts.headers ?? {}) },
  });
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
