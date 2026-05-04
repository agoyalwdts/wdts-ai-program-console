/**
 * POST /api/webhooks/litellm
 *
 * Operator guidelines (config, env, Cursor vs OpenAI, security):
 *   docs/gateway-and-litellm.md
 *
 * Receives LiteLLM Proxy **generic_api** webhook batches (JSON array of
 * `StandardLoggingPayload`-shaped objects) and upserts `UsageRecord` rows
 * (same mirror as `POST /api/webhooks/usage-ingest`).
 *
 * LiteLLM config.yaml example:
 *
 * ```yaml
 * litellm_settings:
 *   callbacks: ["wdts_dashboard"]
 * callback_settings:
 *   wdts_dashboard:
 *     callback_type: generic_api
 *     endpoint: https://<dashboard-host>/api/webhooks/litellm
 *     headers:
 *       Authorization: "Bearer ${LITELLM_WEBHOOK_SECRET}"
 *     event_types:
 *       - llm_api_success
 *       - llm_api_failure
 * ```
 *
 * Env:
 *   - `LITELLM_WEBHOOK_SECRET` — required; must match the Bearer token value.
 *   - `LITELLM_DEFAULT_PRODUCT` — optional; default `CHATGPT` (Product enum).
 *   - `LITELLM_DEFAULT_REGION` — optional; default `global`.
 *   - `LITELLM_INFER_CURSOR_PRODUCT` — optional; default on. Set `0` or
 *     `false` to disable Cursor inference (see `normalize.ts`).
 *
 * Each log must carry a resolvable **user email** in metadata (see
 * `lib/integrations/litellm/normalize.ts`), e.g. `user_email`:
 * `agoyal@wdtablesystems.com` for the seeded owner in dev. Prompt/response
 * bodies are ignored.
 */

import { NextResponse } from "next/server";
import type { Product } from "@prisma/client";
import {
  normalizeLiteLLmLogRow,
  parseLiteLLmWebhookJson,
} from "@/lib/integrations/litellm";
import type { LiteLLmIngestDefaults } from "@/lib/integrations/litellm";
import { prisma } from "@/lib/prisma";
import { verifyLiteLLmBearerToken } from "@/lib/webhooks/litellm-bearer";
import { recordUsageIngestBatchDecision } from "@/lib/gateway-mirror/record-ingest-decision";
import { validateUsageIngestEvents, upsertValidatedUsageEvents } from "@/lib/usage-ingest";
import { USAGE_INGEST_MAX_EVENTS } from "@/lib/usage-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;

const PRODUCT_ENUM = new Set<string>([
  "CHATGPT",
  "CODEX",
  "CURSOR",
  "CLAUDE_AI",
  "M365_COPILOT",
]);

function readDefaults(): { ok: true; defaults: LiteLLmIngestDefaults } | { ok: false; error: string } {
  const raw = process.env.LITELLM_DEFAULT_PRODUCT?.trim() ?? "CHATGPT";
  if (!PRODUCT_ENUM.has(raw)) {
    return {
      ok: false,
      error: `LITELLM_DEFAULT_PRODUCT=${raw} is invalid; expected a Product enum value`,
    };
  }
  const region = process.env.LITELLM_DEFAULT_REGION?.trim() || "global";
  const inferCursor =
    process.env.LITELLM_INFER_CURSOR_PRODUCT !== "0" &&
    process.env.LITELLM_INFER_CURSOR_PRODUCT !== "false";

  return {
    ok: true,
    defaults: {
      defaultProduct: raw as Product,
      defaultRegion: region,
      inferCursorProduct: inferCursor,
    },
  };
}

/** Browsers send GET — this route only accepts POST from LiteLLM generic_api. */
export async function GET(): Promise<Response> {
  return NextResponse.json(
    {
      ok: false,
      message:
        "Use POST with Authorization: Bearer … and a JSON array of LiteLLM log payloads (generic_api). Opening this URL in a browser only sends GET.",
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.LITELLM_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "LITELLM_WEBHOOK_SECRET is not configured." },
      { status: 503 },
    );
  }

  const bearer = verifyLiteLLmBearerToken({
    authorizationHeader: request.headers.get("authorization"),
    secret,
  });
  if (!bearer.ok) {
    return NextResponse.json(
      { ok: false, error: `unauthorized: ${bearer.reason}` },
      { status: 401 },
    );
  }

  const def = readDefaults();
  if (!def.ok) {
    return NextResponse.json({ ok: false, error: def.error }, { status: 500 });
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: `body exceeds ${MAX_BYTES} bytes` },
      { status: 413 },
    );
  }

  let json: unknown;
  try {
    json = rawBody.trim() ? JSON.parse(rawBody) : null;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const logs = parseLiteLLmWebhookJson(json);
  if (!Array.isArray(logs)) {
    return NextResponse.json({ ok: false, error: logs.error }, { status: 400 });
  }
  if (logs.length === 0) {
    return NextResponse.json({ ok: false, error: "empty log batch" }, { status: 400 });
  }
  if (logs.length > USAGE_INGEST_MAX_EVENTS) {
    return NextResponse.json(
      { ok: false, error: `at most ${USAGE_INGEST_MAX_EVENTS} logs per request` },
      { status: 400 },
    );
  }

  const events: unknown[] = [];
  const rejected: Array<{ index: number; reason: string }> = [];

  for (let i = 0; i < logs.length; i++) {
    const n = normalizeLiteLLmLogRow(logs[i], def.defaults);
    if (!n.ok) {
      rejected.push({ index: i, reason: n.reason });
      continue;
    }
    events.push(n.event);
  }

  if (events.length === 0) {
    return NextResponse.json(
      { ok: false, error: "no logs could be normalised", rejected },
      { status: 422 },
    );
  }

  const { valid, rejected: valRejected } = await validateUsageIngestEvents(prisma, events);
  const allRejected = [...rejected, ...valRejected];

  if (valid.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "no valid events after user resolution",
        rejected: allRejected,
      },
      { status: 422 },
    );
  }

  const { upserted } = await upsertValidatedUsageEvents(prisma, valid);

  await recordUsageIngestBatchDecision(prisma, {
    source: "litellm",
    upserted,
    accepted: valid.length,
    rejected: allRejected,
  });

  return NextResponse.json({
    ok: true,
    upserted,
    accepted: valid.length,
    rejected: allRejected,
  });
}
