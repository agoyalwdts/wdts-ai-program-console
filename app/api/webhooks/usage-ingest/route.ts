/**
 * POST /api/webhooks/usage-ingest
 *
 * Guidelines: docs/gateway-and-litellm.md
 *
 * HMAC-authenticated batch ingest into `UsageRecord` (the gateway mirror).
 * Intended for a future AI gateway, or an operator-owned forwarder, to
 * push normalised events without prompt/response bodies.
 *
 * Auth (fail-closed):
 *   - `USAGE_INGEST_HMAC_SECRET` must be set or the handler returns 503.
 *   - Header `x-usage-ingest-signature: sha256=<hex>` where hex =
 *     HMAC_SHA256(secret, raw_body) — same construction as
 *     `lib/cron/auth.ts` / Deel webhook.
 *
 * JSON body:
 *   {
 *     "events": [
 *       {
 *         "sourceEventId": "vendor-unique-id (required, idempotent)",
 *         "userEmail": "match User.email in Prisma (e.g. agoyal@wdtablesystems.com in seed)",
 *         "product": "CHATGPT" | "CODEX" | "CURSOR" | "CLAUDE_AI" | "M365_COPILOT",
 *         "model": "string",
 *         "tokensIn": number | null,
 *         "tokensOut": number | null,
 *         "costUsd": number | null,
 *         "decision": "ALLOWED" | "PROMPTED" | "BLOCKED" | "DOWNGRADED",
 *         "region": "string",
 *         "ts": "ISO-8601",
 *         "dlpLayersHit": ["optional", "string", "array"]
 *       }
 *     ]
 *   }
 *
 * Response: `{ ok, upserted, rejected: [{ index, reason }] }`
 * Partial success is allowed: valid rows are written; invalid rows are
 * listed in `rejected`. All invalid → 422.
 */

import { NextResponse } from "next/server";
import { verifyHmacSha256Body } from "@/lib/cron/auth";
import { prisma } from "@/lib/prisma";
import { recordUsageIngestBatchDecision } from "@/lib/gateway-mirror/record-ingest-decision";
import {
  parseUsageIngestBody,
  validateUsageIngestEvents,
  upsertValidatedUsageEvents,
} from "@/lib/usage-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;

/** Browsers send GET — this route only accepts signed POST bodies. */
export async function GET(): Promise<Response> {
  return NextResponse.json(
    {
      ok: false,
      message:
        "Use POST with JSON { events: [...] } and header x-usage-ingest-signature (HMAC-SHA256 of raw body). Opening this URL in a browser only sends GET.",
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.USAGE_INGEST_HMAC_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "USAGE_INGEST_HMAC_SECRET is not configured." },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: `body exceeds ${MAX_BYTES} bytes` },
      { status: 413 },
    );
  }

  const verification = verifyHmacSha256Body({
    rawBody,
    signatureHeader: request.headers.get("x-usage-ingest-signature"),
    secret,
    missingHeaderReason: "missing x-usage-ingest-signature header",
  });
  if (!verification.ok) {
    return NextResponse.json(
      { ok: false, error: `signature verification failed: ${verification.reason}` },
      { status: 401 },
    );
  }

  let json: unknown;
  try {
    json = rawBody.trim() ? JSON.parse(rawBody) : null;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = parseUsageIngestBody(json);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const { valid, rejected } = await validateUsageIngestEvents(prisma, parsed.events);

  if (valid.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "no valid events to apply",
        rejected,
      },
      { status: 422 },
    );
  }

  const { upserted } = await upsertValidatedUsageEvents(prisma, valid);

  await recordUsageIngestBatchDecision(prisma, {
    source: "generic_usage_ingest",
    upserted,
    accepted: valid.length,
    rejected,
  });

  return NextResponse.json({
    ok: true,
    upserted,
    accepted: valid.length,
    rejected,
  });
}
