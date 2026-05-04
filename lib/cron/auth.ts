/**
 * Shared HMAC verification for cron-style endpoints (`/api/cron/*`).
 *
 * Cron endpoints are unauthenticated by session — they exist to be
 * called by external schedulers (GitHub Actions, Azure Logic Apps, an
 * external uptime checker, etc.). To keep them from being a free
 * "do this expensive operation" handle for anyone on the internet,
 * each request must carry a signature header that the dashboard
 * verifies against `CRON_SHARED_SECRET`.
 *
 * Algorithm — same as the Deel webhook (HMAC-SHA256 over the raw body)
 * so operators only have to learn one shape:
 *
 *   x-cron-signature: sha256=<hex(HMAC_SHA256(secret, raw_body))>
 *
 * Why HMAC of the body and not a bearer token:
 *   - A bearer token in a header is replayable forever. The HMAC is
 *     bound to the request body, so a leaked signature for one request
 *     can't be replayed against a different request.
 *   - For cron triggers the body is typically `{}`, but the HMAC
 *     contract is identical to the Deel webhook so the route handler
 *     is the same shape.
 *   - The body still has to match exactly, so an empty `{}` is fine
 *     but a tampered payload is not — which we'll need once cron jobs
 *     start carrying parameters (e.g. `{"dryRun":true}`).
 *
 * Constant-time comparison via `timingSafeEqual` is mandatory.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type CronVerification =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Generic HMAC-SHA256 over the raw UTF-8 body. Used by cron routes
 * (`x-cron-signature`) and usage-ingest (`x-usage-ingest-signature`).
 */
export function verifyHmacSha256Body(args: {
  rawBody: string;
  signatureHeader: string | null;
  secret: string;
  missingHeaderReason?: string;
}): CronVerification {
  if (!args.signatureHeader) {
    return {
      ok: false,
      reason: args.missingHeaderReason ?? "missing signature header",
    };
  }
  const expected = createHmac("sha256", args.secret)
    .update(args.rawBody, "utf-8")
    .digest("hex");
  const presented = args.signatureHeader.replace(/^sha256=/i, "").trim();
  if (presented.length !== expected.length) {
    return { ok: false, reason: "signature length mismatch" };
  }
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(presented, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}

export function verifyCronSignature(args: {
  rawBody: string;
  signatureHeader: string | null;
  secret: string;
}): CronVerification {
  return verifyHmacSha256Body({
    ...args,
    missingHeaderReason: "missing x-cron-signature header",
  });
}

/**
 * Convenience for operators who want to compute a signature from a
 * shell script — emits the same string the dashboard expects in
 * `x-cron-signature`.
 *
 *   curl -H "x-cron-signature: $(node -e 'computeCronSignature(...)')" \
 *        -H "content-type: application/json" \
 *        -d '{}' \
 *        https://<dashboard>/api/cron/reconcile-azuread
 */
export function computeCronSignature(args: {
  rawBody: string;
  secret: string;
}): string {
  return computeHmacSha256Signature(args);
}

/** Same algorithm as cron — for usage-ingest curl scripts. */
export function computeHmacSha256Signature(args: {
  rawBody: string;
  secret: string;
}): string {
  const hex = createHmac("sha256", args.secret)
    .update(args.rawBody, "utf-8")
    .digest("hex");
  return `sha256=${hex}`;
}
