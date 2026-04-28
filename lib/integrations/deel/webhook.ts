/**
 * Pure helpers for verifying + interpreting Deel webhooks. Lives next
 * to the integration so both the route handler and tests can import.
 *
 * Signature algorithm (per Deel's webhook docs):
 *   x-deel-signature: sha256=<hex(HMAC_SHA256(secret, raw_body))>
 *
 * Constant-time comparison is mandatory — early-exit comparison opens
 * a timing oracle on the secret.
 *
 * The dashboard treats every webhook as "advisory" — i.e. a hint to
 * re-fetch authoritative state. We do NOT mutate Prisma directly from
 * a webhook payload; the receiver records the event and triggers a
 * targeted re-fetch via DeelClient.getEmployeeByEmail(). This keeps
 * the data model as a function of "Deel REST API at point in time"
 * and avoids replay-attack / out-of-order-event corruption.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { mapDeelPersonToEmployee, type DeelPersonRaw } from "./mapping";
import type { DeelEmployee, DeelWebhookEvent } from "./types";

export type WebhookVerification =
  | { ok: true }
  | { ok: false; reason: string };

export function verifyDeelSignature(args: {
  rawBody: string;
  signatureHeader: string | null;
  secret: string;
}): WebhookVerification {
  if (!args.signatureHeader) {
    return { ok: false, reason: "missing x-deel-signature header" };
  }
  const expected = createHmac("sha256", args.secret)
    .update(args.rawBody, "utf-8")
    .digest("hex");
  // Header may be either '<hex>' or 'sha256=<hex>'; normalise.
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

/**
 * Deel webhook envelope (subset). The shape varies by Deel
 * configuration but the relevant top-level fields are stable.
 */
export type DeelWebhookEnvelope = {
  /** e.g. 'employee.updated', 'employee.terminated', 'employee.hired'. */
  event_type?: string;
  type?: string;
  data?: { resource?: DeelPersonRaw } | DeelPersonRaw;
};

export function parseDeelWebhook(env: DeelWebhookEnvelope): DeelWebhookEvent | null {
  const rawType = (env.event_type ?? env.type ?? "").toLowerCase();
  let mapped: DeelWebhookEvent["type"];
  if (rawType.includes("hire") || rawType.includes("create")) mapped = "EMPLOYEE_HIRED";
  else if (rawType.includes("terminat") || rawType.includes("offboard"))
    mapped = "EMPLOYEE_TERMINATED";
  else if (rawType.includes("update") || rawType.includes("change"))
    mapped = "EMPLOYEE_UPDATED";
  else return null;

  const dataNode = env.data;
  if (!dataNode) return null;
  // Deel sometimes wraps the person under data.resource and sometimes
  // puts the person directly under data.
  const personRaw: DeelPersonRaw =
    "resource" in (dataNode as object) && dataNode !== null
      ? ((dataNode as { resource?: DeelPersonRaw }).resource ?? {})
      : (dataNode as DeelPersonRaw);
  if (!personRaw.email && !personRaw.work_email) return null;

  const payload: DeelEmployee = mapDeelPersonToEmployee(personRaw);
  return {
    type: mapped,
    email: payload.email,
    payload,
    receivedAt: new Date(),
  };
}
