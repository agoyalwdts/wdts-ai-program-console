import type { PrismaClient, Product, UsageDecision } from "@prisma/client";
import type { UsageIngestRejected, ValidatedUsageIngestEvent } from "./types";
import { USAGE_INGEST_MAX_EVENTS } from "./types";

const PRODUCT_SET = new Set<string>([
  "CHATGPT",
  "CODEX",
  "CURSOR",
  "CLAUDE_AI",
  "M365_COPILOT",
]);

const DECISION_SET = new Set<string>(["ALLOWED", "PROMPTED", "BLOCKED", "DOWNGRADED"]);

export type ParsedUsageIngestBody =
  | { ok: true; events: unknown[] }
  | { ok: false; error: string };

export function parseUsageIngestBody(body: unknown): ParsedUsageIngestBody {
  if (body == null || typeof body !== "object") {
    return { ok: false, error: "JSON body must be an object" };
  }
  const events = (body as { events?: unknown }).events;
  if (!Array.isArray(events)) {
    return { ok: false, error: 'JSON must contain an "events" array' };
  }
  if (events.length === 0) {
    return { ok: false, error: '"events" must be non-empty' };
  }
  if (events.length > USAGE_INGEST_MAX_EVENTS) {
    return {
      ok: false,
      error: `at most ${USAGE_INGEST_MAX_EVENTS} events per request`,
    };
  }
  return { ok: true, events };
}

/**
 * Validates each event shape and resolves `userEmail` → `userId` via Prisma.
 * Unknown emails produce a rejection row; they do not fail the whole batch.
 */
export async function validateUsageIngestEvents(
  prisma: PrismaClient,
  events: unknown[],
): Promise<{
  valid: ValidatedUsageIngestEvent[];
  rejected: UsageIngestRejected[];
}> {
  const valid: ValidatedUsageIngestEvent[] = [];
  const rejected: UsageIngestRejected[] = [];

  const emailToUserId = new Map<string, string>();

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || typeof ev !== "object") {
      rejected.push({ index: i, reason: "event must be an object" });
      continue;
    }
    const o = ev as Record<string, unknown>;

    const sid = o.sourceEventId;
    if (typeof sid !== "string" || sid.length < 8 || sid.length > 256) {
      rejected.push({
        index: i,
        reason: "sourceEventId must be a string (8..256 chars)",
      });
      continue;
    }

    const emailRaw = o.userEmail;
    if (typeof emailRaw !== "string" || !emailRaw.includes("@")) {
      rejected.push({ index: i, reason: "userEmail must be a valid email string" });
      continue;
    }
    const emailNorm = emailRaw.trim().toLowerCase();

    const productRaw = o.product;
    if (typeof productRaw !== "string" || !PRODUCT_SET.has(productRaw)) {
      rejected.push({
        index: i,
        reason: `product must be one of: ${[...PRODUCT_SET].join(", ")}`,
      });
      continue;
    }
    const product = productRaw as Product;

    const model = o.model;
    if (typeof model !== "string" || !model.trim()) {
      rejected.push({ index: i, reason: "model must be a non-empty string" });
      continue;
    }

    const region = o.region;
    if (typeof region !== "string" || !region.trim()) {
      rejected.push({ index: i, reason: "region must be a non-empty string" });
      continue;
    }

    const tsRaw = o.ts;
    if (typeof tsRaw !== "string") {
      rejected.push({ index: i, reason: "ts must be an ISO-8601 string" });
      continue;
    }
    const ts = new Date(tsRaw);
    if (Number.isNaN(ts.getTime())) {
      rejected.push({ index: i, reason: "ts is not a valid date" });
      continue;
    }

    const decisionRaw = o.decision ?? "ALLOWED";
    if (typeof decisionRaw !== "string" || !DECISION_SET.has(decisionRaw)) {
      rejected.push({
        index: i,
        reason: `decision must be one of: ${[...DECISION_SET].join(", ")}`,
      });
      continue;
    }
    const decision = decisionRaw as UsageDecision;

    let tokensIn: number | null = null;
    if (o.tokensIn !== undefined && o.tokensIn !== null) {
      if (typeof o.tokensIn !== "number" || !Number.isFinite(o.tokensIn) || o.tokensIn < 0) {
        rejected.push({ index: i, reason: "tokensIn must be a non-negative number or null" });
        continue;
      }
      tokensIn = Math.floor(o.tokensIn);
    }

    let tokensOut: number | null = null;
    if (o.tokensOut !== undefined && o.tokensOut !== null) {
      if (typeof o.tokensOut !== "number" || !Number.isFinite(o.tokensOut) || o.tokensOut < 0) {
        rejected.push({ index: i, reason: "tokensOut must be a non-negative number or null" });
        continue;
      }
      tokensOut = Math.floor(o.tokensOut);
    }

    let costUsd: number | null = null;
    if (o.costUsd !== undefined && o.costUsd !== null) {
      if (typeof o.costUsd !== "number" || !Number.isFinite(o.costUsd) || o.costUsd < 0) {
        rejected.push({ index: i, reason: "costUsd must be a non-negative number or null" });
        continue;
      }
      costUsd = o.costUsd;
    }

    let dlpLayersHit: string[] = [];
    if (o.dlpLayersHit !== undefined) {
      if (!Array.isArray(o.dlpLayersHit)) {
        rejected.push({ index: i, reason: "dlpLayersHit must be an array of strings" });
        continue;
      }
      let dlpOk = true;
      for (const x of o.dlpLayersHit) {
        if (typeof x !== "string") {
          rejected.push({ index: i, reason: "dlpLayersHit must contain only strings" });
          dlpOk = false;
          break;
        }
      }
      if (!dlpOk) continue;
      dlpLayersHit = o.dlpLayersHit.filter((x): x is string => typeof x === "string");
    }

    let userId = emailToUserId.get(emailNorm);
    if (!userId) {
      const u = await prisma.user.findFirst({
        where: { email: { equals: emailNorm, mode: "insensitive" } },
        select: { id: true },
      });
      if (!u) {
        rejected.push({
          index: i,
          reason: `no User row for email: ${emailNorm}`,
        });
        continue;
      }
      userId = u.id;
      emailToUserId.set(emailNorm, userId);
    }

    valid.push({
      sourceEventId: sid,
      userId,
      product,
      model: model.trim(),
      tokensIn,
      tokensOut,
      costUsd,
      decision,
      region: region.trim(),
      ts,
      dlpLayersHit,
    });
  }

  return { valid, rejected };
}
