/**
 * Parse COSTS JSONL from Compliance Logs (Unified Credit Usage API alpha).
 */

import type { UnifiedCreditsEnvelope, UnifiedCreditsRow } from "./types";
import { UNIFIED_CREDITS_EVENT_TYPE } from "./constants";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function extractPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...raw };
  const nested = asRecord(raw.payload) ?? asRecord(raw.costs) ?? asRecord(raw.data);
  if (nested) Object.assign(merged, nested);
  return merged;
}

export function parseUnifiedCreditsJsonl(body: string): UnifiedCreditsEnvelope[] {
  const out: UnifiedCreditsEnvelope[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const rec = asRecord(JSON.parse(line) as unknown);
      if (!rec) continue;
      const event_id = pickString(rec, ["event_id", "eventId"]);
      const type = pickString(rec, ["type", "event_type", "eventType"]);
      if (!event_id || !type) continue;
      out.push({
        event_id,
        type,
        timestamp: pickString(rec, ["timestamp", "ts"]),
        payload: extractPayload(rec),
      });
    } catch {
      continue;
    }
  }
  return out;
}

function parseBillingLines(measures: Record<string, unknown> | null): UnifiedCreditsRow["billing"] {
  const billing = measures?.billing;
  if (!Array.isArray(billing)) return [];
  const out: UnifiedCreditsRow["billing"] = [];
  for (const entry of billing) {
    const e = asRecord(entry);
    if (!e) continue;
    const sku = pickString(e, ["sku"]) ?? "unknown";
    const cost = asRecord(e.cost);
    const unit = pickString(cost ?? {}, ["unit"]);
    const value = pickNumber(cost ?? {}, ["value"]);
    if (unit?.toUpperCase() === "CREDITS" && value != null && value > 0) {
      out.push({ sku, credits: value });
    }
  }
  return out;
}

export function mapCostsEnvelope(env: UnifiedCreditsEnvelope): UnifiedCreditsRow | null {
  if (
    env.type !== UNIFIED_CREDITS_EVENT_TYPE &&
    env.type.toUpperCase() !== UNIFIED_CREDITS_EVENT_TYPE
  ) {
    return null;
  }

  const p = env.payload;
  const day =
    pickString(p, ["day"]) ??
    (env.timestamp && /^\d{4}-\d{2}-\d{2}/.test(env.timestamp)
      ? env.timestamp.slice(0, 10)
      : undefined);
  const hour = pickNumber(p, ["hour"]);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || hour == null) return null;

  const identity = asRecord(p.identity);
  const measures = asRecord(p.measures);
  const billing = parseBillingLines(measures);
  const credits_total = billing.reduce((s, b) => s + b.credits, 0);
  if (credits_total <= 0) return null;

  return {
    event_id: env.event_id,
    day,
    hour,
    user_id: pickString(identity ?? {}, ["user_id", "userId"]) ?? pickString(p, ["user_id"]),
    email: pickString(identity ?? {}, ["email"]),
    name: pickString(identity ?? {}, ["name"]),
    product: pickString(p, ["product"]),
    surface: pickString(p, ["surface"]),
    client: pickString(p, ["client"]),
    model: pickString(p, ["model"]),
    service_tier: pickString(p, ["service_tier", "serviceTier"]),
    billing,
    credits_total,
    raw: p,
  };
}
