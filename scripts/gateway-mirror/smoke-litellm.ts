/**
 * One-shot POST to `POST /api/webhooks/litellm` mimicking a generic_api batch.
 *
 *   LITELLM_WEBHOOK_SECRET=… BASE_URL=http://127.0.0.1:3000 npx tsx scripts/gateway-mirror/smoke-litellm.ts
 *
 * The secret must match `LITELLM_WEBHOOK_SECRET` on the server. Uses seeded
 * owner email unless `SMOKE_USER_EMAIL` is set.
 */

const base = process.env.BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:3000";
const bearer = process.env.LITELLM_WEBHOOK_SECRET?.trim();
if (!bearer) {
  console.error("LITELLM_WEBHOOK_SECRET is required (same value as on the dashboard)");
  process.exit(1);
}

const userEmail = process.env.SMOKE_USER_EMAIL?.trim() ?? "agoyal@wdtablesystems.com";
const id = `smoke-litellm-${Date.now()}`;

const batch = [
  {
    id,
    call_type: "litellm.completion",
    model: "gpt-4o-mini",
    prompt_tokens: 10,
    completion_tokens: 2,
    response_cost: 0.0001,
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    status: "success",
    metadata: { user_email: userEmail },
  },
];

const body = JSON.stringify(batch);

const res = await fetch(`${base}/api/webhooks/litellm`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    Authorization: `Bearer ${bearer}`,
  },
  body,
});

const text = await res.text();
console.log(res.status, text);
process.exit(res.ok ? 0 : 1);

export {};
