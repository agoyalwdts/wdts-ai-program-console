/**
 * Cron handler for the AzureAD reconciler.
 *
 * Why this exists:
 *   `npm run reconcile:azuread` is invoke-by-hand. As soon as
 *   `INTEGRATION_AZUREAD=real` is on (it is, in prod, since 2026-04-29),
 *   the local User mirror starts drifting from the IdP every minute
 *   nobody runs the reconciler. This route gives an external scheduler
 *   (GitHub Actions cron, Azure Logic Apps, Pingdom-style uptime
 *   checker — operator's choice) one HTTP target to hit on a schedule.
 *
 * Auth model (closed-by-default):
 *   - The endpoint is excluded from session auth via `PUBLIC_PATHS` in
 *     auth.ts (the `/api/cron` prefix). Anyone can reach the URL.
 *   - The route requires `CRON_SHARED_SECRET` to be set, otherwise it
 *     returns 503 — matches the Deel-webhook fail-closed pattern.
 *   - Every request must carry an `x-cron-signature: sha256=<hex>`
 *     header that's an HMAC-SHA256 of the raw body. Verified with
 *     constant-time compare in `lib/cron/auth.ts`.
 *
 * Body:
 *   Optional JSON `{ "dryRun": boolean }`. Empty body == apply mode.
 *   The body is part of the HMAC, so flipping dryRun by a malicious
 *   actor without re-signing won't authenticate.
 *
 * Response:
 *   200 + the ReconcilerSummary JSON on success.
 *   503 if CRON_SHARED_SECRET isn't configured.
 *   401 on signature failure.
 *   400 on malformed JSON body.
 *
 * Refs: scoping §4 integration #1 (AzureAD); §9.1 (every state-changing
 * write through a Decision row — the reconciler does this internally).
 */

import { NextResponse } from "next/server";
import { verifyCronSignature } from "@/lib/cron/auth";
import { reconcileAzureAD } from "@/prisma/scripts/reconcile-azuread";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CronBody = {
  dryRun?: boolean;
};

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SHARED_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SHARED_SECRET is not configured." },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  const verification = verifyCronSignature({
    rawBody,
    signatureHeader: request.headers.get("x-cron-signature"),
    secret,
  });
  if (!verification.ok) {
    return NextResponse.json(
      { error: `signature verification failed: ${verification.reason}` },
      { status: 401 },
    );
  }

  let parsed: CronBody = {};
  if (rawBody.trim()) {
    try {
      parsed = JSON.parse(rawBody) as CronBody;
    } catch {
      return NextResponse.json(
        { error: "invalid JSON body" },
        { status: 400 },
      );
    }
  }

  const dryRun = Boolean(parsed.dryRun);
  const summary = await reconcileAzureAD({ dryRun });
  return NextResponse.json({ ok: true, dryRun, summary });
}

/**
 * GET is intentionally unsupported. A typical "trigger by visiting in
 * a browser" pattern would force a sessionful URL or a query-string
 * secret — both worse than HMAC-on-POST. Operators with curl can sign
 * a `{}` body and POST.
 */
export async function GET(): Promise<Response> {
  return NextResponse.json(
    {
      error: "method not allowed",
      hint:
        "Sign a POST with x-cron-signature. See lib/cron/auth.ts and " +
        "docs/deploy/azure.md §'Cron triggers'.",
    },
    { status: 405 },
  );
}
