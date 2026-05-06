import { createHash } from "node:crypto";
import { DecisionType, Prisma, type PrismaClient, type Product } from "@prisma/client";
import {
  DAY_ONE_DEFAULT_MODEL,
  DISABLED_MODE_MARKERS,
  MODEL_ALLOWLIST,
  STRICT_REGION_ALLOWLIST,
  type ProductKey,
} from "./day-one-defaults";
import { evaluateModelAdvisor, productFromUsageProduct } from "./advisor";
import { sendGuardrailPolicyDigest } from "@/lib/notify/guardrail-policy-email";

type Candidate = {
  occurredAt: Date;
  category: string;
  severity: string;
  ruleCode: string;
  title: string;
  rationale: string;
  recommendation: string | null;
  environment: string | null;
  product: ProductKey | null;
  userEmail: string | null;
  model: string | null;
  source: string;
  context: Prisma.InputJsonValue;
  dedupeKey: string;
};

export type GuardrailMonitorSummary = {
  scannedUsageRows: number;
  scannedDecisions: number;
  candidates: number;
  inserted: number;
  emailed: number;
  emailError: string | null;
};

function dashboardOrigin(): string {
  const u = process.env.NEXTAUTH_URL?.trim();
  if (u) return u.replace(/\/$/, "");
  const v = process.env.VERCEL_URL?.trim();
  if (v) return `https://${v.replace(/^https?:\/\//, "")}`;
  return "http://localhost:3000";
}

function dedupe(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function envMode(): "dev" | "sandbox" | "staging" | "prod" {
  const raw = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "dev").toLowerCase();
  if (raw.includes("prod")) return "prod";
  if (raw.includes("stag")) return "staging";
  if (raw.includes("sand")) return "sandbox";
  return "dev";
}

function pushUsageCandidates(args: {
  candidates: Candidate[];
  row: {
    ts: Date;
      product: Product;
    model: string;
    tokensIn: number | null;
    tokensOut: number | null;
    decision: string;
    region: string;
    costUsd: number | null;
    userEmail: string | null;
  };
  environment: string;
}): void {
  const product = productFromUsageProduct(args.row.product);
  if (!product) return;

  const advisor = evaluateModelAdvisor({
    product,
    selectedModel: args.row.model,
    tokensIn: args.row.tokensIn,
    tokensOut: args.row.tokensOut,
    maxMode: args.row.model.toLowerCase().includes("max"),
  });

  if (advisor.disabledModeHit) {
    args.candidates.push({
      occurredAt: args.row.ts,
      category: "MODEL_POSTURE",
      severity: "HIGH",
      ruleCode: "DAY_ONE_DISABLED_MODE_USED",
      title: "Disabled day-one mode was used",
      rationale: `Model string indicates a disabled mode (${DISABLED_MODE_MARKERS[product].join(", ")}) for ${product}.`,
      recommendation: `Use default ${DAY_ONE_DEFAULT_MODEL[product]} unless exception approved.`,
      environment: args.environment,
      product,
      userEmail: args.row.userEmail,
      model: args.row.model,
      source: "USAGE_RECORD",
      context: {
        decision: args.row.decision,
        region: args.row.region,
        tokensIn: args.row.tokensIn,
        tokensOut: args.row.tokensOut,
      },
      dedupeKey: dedupe([
        "DAY_ONE_DISABLED_MODE_USED",
        product,
        args.row.userEmail ?? "",
        args.row.model,
        args.row.ts.toISOString().slice(0, 10),
      ]),
    });
  }

  if (advisor.message && advisor.recommendation) {
    args.candidates.push({
      occurredAt: args.row.ts,
      category: "COMPLEXITY_ADVISOR",
      severity: advisor.heavyModel ? "MEDIUM" : "LOW",
      ruleCode: advisor.heavyModel
        ? "NON_COMPLEX_HEAVY_MODEL_SELECTED"
        : "NON_COMPLEX_NON_DEFAULT_MODEL",
      title: "Complexity-aware advisor recommends lower-cost model",
      rationale: advisor.message,
      recommendation: advisor.recommendation,
      environment: args.environment,
      product,
      userEmail: args.row.userEmail,
      model: args.row.model,
      source: "USAGE_RECORD",
      context: {
        complexityScore: advisor.complexityScore,
        complexityClass: advisor.complexityClass,
        tokensIn: args.row.tokensIn,
        tokensOut: args.row.tokensOut,
        costUsd: args.row.costUsd,
      },
      dedupeKey: dedupe([
        advisor.heavyModel
          ? "NON_COMPLEX_HEAVY_MODEL_SELECTED"
          : "NON_COMPLEX_NON_DEFAULT_MODEL",
        product,
        args.row.userEmail ?? "",
        args.row.model,
        args.row.ts.toISOString().slice(0, 10),
      ]),
    });
  }

  const allowed = MODEL_ALLOWLIST[product].test(args.row.model);
  if (!allowed && (args.environment === "staging" || args.environment === "prod")) {
    args.candidates.push({
      occurredAt: args.row.ts,
      category: "CLOUD_CONTROL",
      severity: "HIGH",
      ruleCode: "UNAPPROVED_MODEL_ENDPOINT",
      title: "Model not on allowlist",
      rationale: `Selected model '${args.row.model}' is not on the approved ${product} allowlist in ${args.environment}.`,
      recommendation: `Switch to ${DAY_ONE_DEFAULT_MODEL[product]} or request a time-bound exception.`,
      environment: args.environment,
      product,
      userEmail: args.row.userEmail,
      model: args.row.model,
      source: "USAGE_RECORD",
      context: { region: args.row.region },
      dedupeKey: dedupe([
        "UNAPPROVED_MODEL_ENDPOINT",
        args.environment,
        product,
        args.row.userEmail ?? "",
        args.row.model,
        args.row.ts.toISOString().slice(0, 10),
      ]),
    });
  }

  const region = args.row.region.toLowerCase();
  if (
    (args.environment === "staging" || args.environment === "prod") &&
    region &&
    !STRICT_REGION_ALLOWLIST.includes(region as (typeof STRICT_REGION_ALLOWLIST)[number])
  ) {
    args.candidates.push({
      occurredAt: args.row.ts,
      category: "CLOUD_CONTROL",
      severity: "MEDIUM",
      ruleCode: "REGION_OUTSIDE_STRICT_ALLOWLIST",
      title: "Cloud region outside strict allowlist",
      rationale: `Usage event region '${args.row.region}' is outside strict allowlist for ${args.environment}.`,
      recommendation: "Route through approved regions or log a reviewed exception.",
      environment: args.environment,
      product,
      userEmail: args.row.userEmail,
      model: args.row.model,
      source: "USAGE_RECORD",
      context: { allowedRegions: STRICT_REGION_ALLOWLIST },
      dedupeKey: dedupe([
        "REGION_OUTSIDE_STRICT_ALLOWLIST",
        args.environment,
        args.row.region,
        product,
        args.row.userEmail ?? "",
        args.row.ts.toISOString().slice(0, 10),
      ]),
    });
  }
}

function pushDecisionCandidates(args: {
  candidates: Candidate[];
  row: {
    ts: Date;
    type: string;
    actorEmail: string;
    evidenceLink: string | null;
    id: string;
  };
  environment: string;
}): void {
  const highRiskTypes = new Set([
    "CAP_ADJUSTMENT",
    "ROLE_CHANGE",
    "TIER_PROMOTION",
    "TIER_DEMOTION",
    "EXCEPTION_GRANT",
  ]);
  if (!highRiskTypes.has(args.row.type)) return;

  const actor = args.row.actorEmail.toLowerCase();
  if (
    (args.environment === "staging" || args.environment === "prod") &&
    (actor.includes("agent") || actor.includes("bot") || actor.includes("automation"))
  ) {
    args.candidates.push({
      occurredAt: args.row.ts,
      category: "CLOUD_CONTROL",
      severity: "HIGH",
      ruleCode: "UNATTENDED_HIGH_RISK_ACTION",
      title: "High-risk action performed by automation identity",
      rationale:
        "Day-one cloud guardrail forbids unattended production deploy/apply style actions without step-up approval.",
      recommendation: "Require human approver and record owner+expiry in evidence link.",
      environment: args.environment,
      product: null,
      userEmail: args.row.actorEmail,
      model: null,
      source: "DECISION",
      context: { decisionType: args.row.type, decisionId: args.row.id },
      dedupeKey: dedupe([
        "UNATTENDED_HIGH_RISK_ACTION",
        args.row.id,
      ]),
    });
  }

  if (!args.row.evidenceLink) {
    args.candidates.push({
      occurredAt: args.row.ts,
      category: "CLOUD_CONTROL",
      severity: "MEDIUM",
      ruleCode: "HIGH_RISK_ACTION_MISSING_EVIDENCE",
      title: "High-risk action missing approval evidence",
      rationale:
        "Step-up approval / exception review evidence is required for high-risk cloud controls (IAM/policy/export/public exposure/resource create).",
      recommendation: "Attach approval ticket/PR with owner + expiry + post-review notes.",
      environment: args.environment,
      product: null,
      userEmail: args.row.actorEmail,
      model: null,
      source: "DECISION",
      context: { decisionType: args.row.type, decisionId: args.row.id },
      dedupeKey: dedupe([
        "HIGH_RISK_ACTION_MISSING_EVIDENCE",
        args.row.id,
      ]),
    });
  }
}

export async function runGuardrailMonitor(
  prisma: PrismaClient,
  args?: { windowHours?: number; actorEmail?: string },
): Promise<GuardrailMonitorSummary> {
  const windowHours = Math.max(1, Math.min(args?.windowHours ?? 24, 24 * 30));
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const env = envMode();

  const [usageRows, decisionRows] = await Promise.all([
    prisma.usageRecord.findMany({
      where: { ts: { gte: since } },
      select: {
        ts: true,
        product: true,
        model: true,
        tokensIn: true,
        tokensOut: true,
        decision: true,
        region: true,
        costUsd: true,
        user: { select: { email: true } },
      },
      take: 10_000,
      orderBy: { ts: "desc" },
    }),
    prisma.decision.findMany({
      where: { ts: { gte: since } },
      select: { id: true, ts: true, type: true, actorEmail: true, evidenceLink: true },
      take: 2_000,
      orderBy: { ts: "desc" },
    }),
  ]);

  const candidates: Candidate[] = [];
  for (const r of usageRows) {
    pushUsageCandidates({
      candidates,
      row: {
        ts: r.ts,
        product: r.product,
        model: r.model,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        decision: r.decision,
        region: r.region,
        costUsd: r.costUsd,
        userEmail: r.user.email,
      },
      environment: env,
    });
  }

  for (const d of decisionRows) {
    pushDecisionCandidates({
      candidates,
      row: d,
      environment: env,
    });
  }

  if (candidates.length === 0) {
    return {
      scannedUsageRows: usageRows.length,
      scannedDecisions: decisionRows.length,
      candidates: 0,
      inserted: 0,
      emailed: 0,
      emailError: null,
    };
  }

  const ins = await prisma.guardrailPolicyAlert.createMany({
    data: candidates.map((c) => ({
      occurredAt: c.occurredAt,
      category: c.category,
      severity: c.severity,
      ruleCode: c.ruleCode,
      title: c.title,
      rationale: c.rationale,
      recommendation: c.recommendation,
      environment: c.environment,
      product: c.product,
      userEmail: c.userEmail,
      model: c.model,
      source: c.source,
      context: c.context,
      dedupeKey: c.dedupeKey,
    })),
    skipDuplicates: true,
  });

  let emailed = 0;
  let emailError: string | null = null;
  const inserted = ins.count;
  if (inserted > 0) {
    const jobStart = new Date(Date.now() - 5 * 60 * 1000);
    const fresh = await prisma.guardrailPolicyAlert.findMany({
      where: {
        dedupeKey: { in: candidates.map((c) => c.dedupeKey) },
        createdAt: { gte: jobStart },
        emailNotifiedAt: null,
      },
      select: {
        id: true,
        category: true,
        severity: true,
        userEmail: true,
        product: true,
        model: true,
        ruleCode: true,
        title: true,
      },
    });
    if (fresh.length > 0) {
      const mail = await sendGuardrailPolicyDigest({
        dashboardBaseUrl: dashboardOrigin(),
        subject: `[WDTS] Guardrail policy alerts (${fresh.length})`,
        lines: fresh.map((f) => ({
          category: f.category,
          severity: f.severity,
          userEmail: f.userEmail,
          product: f.product,
          model: f.model,
          ruleCode: f.ruleCode,
          title: f.title,
        })),
      });
      if (mail.ok && !mail.skipped) {
        emailed = fresh.length;
        await prisma.guardrailPolicyAlert.updateMany({
          where: { id: { in: fresh.map((f) => f.id) } },
          data: { emailNotifiedAt: new Date() },
        });
      } else if (!mail.ok) {
        emailError = mail.error;
      }
    }

    await prisma.decision.create({
      data: {
        type: DecisionType.GUARDRAIL_POLICY_ALERT,
        beforeState: JSON.stringify({ scannedUsageRows: usageRows.length, scannedDecisions: decisionRows.length }),
        afterState: JSON.stringify({ candidates: candidates.length, inserted, emailed, emailError }),
        actorEmail: args?.actorEmail ?? "system:guardrail-monitor",
        justification: `Automated guardrail monitor (${windowHours}h window)` ,
      },
    });
  }

  return {
    scannedUsageRows: usageRows.length,
    scannedDecisions: decisionRows.length,
    candidates: candidates.length,
    inserted,
    emailed,
    emailError,
  };
}
