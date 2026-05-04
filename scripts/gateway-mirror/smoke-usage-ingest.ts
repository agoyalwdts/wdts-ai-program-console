/**
 * One-shot POST to `POST /api/webhooks/usage-ingest` with a valid HMAC.
 *
 *   USAGE_INGEST_HMAC_SECRET=… BASE_URL=http://127.0.0.1:3000 npx tsx scripts/gateway-mirror/smoke-usage-ingest.ts
 *
 * Uses the seeded owner email from the dev seed; override with SMOKE_USER_EMAIL.
 */

import { computeHmacSha256Signature } from "@/lib/cron/auth";

async function main(): Promise<void> {
  const base = process.env.BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:3000";
  const secret = process.env.USAGE_INGEST_HMAC_SECRET?.trim();
  if (!secret) {
    console.error("USAGE_INGEST_HMAC_SECRET is required");
    process.exit(1);
  }

  const userEmail = process.env.SMOKE_USER_EMAIL?.trim() ?? "agoyal@wdtablesystems.com";
  const sourceEventId = `smoke-usage-ingest-${Date.now()}`;

  const body = JSON.stringify({
    events: [
      {
        sourceEventId,
        userEmail,
        product: "CHATGPT",
        model: "smoke-test",
        tokensIn: 1,
        tokensOut: 1,
        costUsd: 0.00001,
        decision: "ALLOWED",
        region: "global",
        ts: new Date().toISOString(),
        dlpLayersHit: [],
      },
    ],
  });

  const sig = computeHmacSha256Signature({ rawBody: body, secret });

  const res = await fetch(`${base}/api/webhooks/usage-ingest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-usage-ingest-signature": sig,
    },
    body,
  });

  const text = await res.text();
  console.log(res.status, text);
  process.exit(res.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
