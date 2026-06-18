import { COMPLEXITY_SCORE_THRESHOLD_NON_COMPLEX } from "./day-one-defaults";

export type GuardrailEvidenceLine = {
  label: string;
  value: string;
};

function ctxRecord(context: unknown): Record<string, unknown> | null {
  if (context && typeof context === "object" && !Array.isArray(context)) {
    return context as Record<string, unknown>;
  }
  return null;
}

function fmtNum(n: unknown, digits = 2): string | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtUsd(n: unknown): string | null {
  const s = fmtNum(n, 4);
  return s != null ? `$${s}` : null;
}

function pushLine(lines: GuardrailEvidenceLine[], label: string, value: string | null | undefined) {
  if (value == null || value === "") return;
  lines.push({ label, value });
}

/** Human-readable usage signals stored on the alert `context` JSON. */
export function guardrailAlertEvidenceLines(args: {
  ruleCode: string;
  product: string | null;
  model: string | null;
  source: string | null;
  context: unknown;
}): GuardrailEvidenceLine[] {
  const ctx = ctxRecord(args.context);
  const lines: GuardrailEvidenceLine[] = [];

  pushLine(lines, "Data source", args.source?.replace(/_/g, " ") ?? null);

  const complexityRules = new Set([
    "NON_COMPLEX_HEAVY_MODEL_SELECTED",
    "NON_COMPLEX_NON_DEFAULT_MODEL",
  ]);

  if (complexityRules.has(args.ruleCode) && ctx) {
    const score = fmtNum(ctx.complexityScore, 2);
    const threshold = fmtNum(ctx.complexityThreshold ?? COMPLEXITY_SCORE_THRESHOLD_NON_COMPLEX, 2);
    if (score != null && threshold != null) {
      pushLine(
        lines,
        "Complexity score",
        `${score} (non-complex if below ${threshold})`,
      );
    }
    pushLine(lines, "Complexity class", typeof ctx.complexityClass === "string" ? ctx.complexityClass : null);
    pushLine(
      lines,
      "Heavy model tier",
      ctx.heavyModel === true ? "Yes — model name matches costly markers" : ctx.heavyModel === false ? "No" : null,
    );
    pushLine(lines, "Day-one default", typeof ctx.defaultModel === "string" ? ctx.defaultModel : null);

    const tin = ctx.tokensIn;
    const tout = ctx.tokensOut;
    const hasTokens =
      (typeof tin === "number" && tin > 0) || (typeof tout === "number" && tout > 0);
    if (ctx.tokenDataMissing === true || !hasTokens) {
      pushLine(
        lines,
        "Token signal",
        "Unavailable from vendor feed — score may default to 0.00 (non-complex)",
      );
    } else {
      pushLine(lines, "Input tokens", fmtNum(tin, 0));
      pushLine(lines, "Output tokens", fmtNum(tout, 0));
      pushLine(lines, "Total tokens", fmtNum(ctx.totalTokens, 0));
      pushLine(lines, "Cache-read tokens", fmtNum(ctx.cacheReadTokens, 0));
    }

    pushLine(lines, "Event cost", fmtUsd(ctx.costUsd));
    pushLine(lines, "Max mode", ctx.maxMode === true ? "On" : ctx.maxMode === false ? "Off" : null);
    pushLine(lines, "Cursor event kind", typeof ctx.usageKind === "string" ? ctx.usageKind : null);

    pushLine(
      lines,
      "Note",
      "Prompt text is not available from vendor APIs. Complexity is inferred from token volume and model tier, not task content.",
    );
    return lines;
  }

  const codexRules = new Set([
    "CODEX_HIGH_DAILY_CREDITS",
    "CODEX_ELEVATED_DAILY_CREDITS",
    "CODEX_MULTI_CLIENT_SURFACE",
  ]);

  if (codexRules.has(args.ruleCode) && ctx) {
    pushLine(lines, "Codex credits (daily bucket)", fmtNum(ctx.credits, 1));
    pushLine(lines, "Turns", fmtNum(ctx.turns, 0));
    pushLine(lines, "Event cost (est.)", fmtUsd(ctx.costUsd));
    if (Array.isArray(ctx.clientIds) && ctx.clientIds.length > 0) {
      pushLine(lines, "Client surfaces", ctx.clientIds.map(String).join(", "));
    }
    if (Array.isArray(ctx.models) && ctx.models.length > 0) {
      const breakdown = ctx.models
        .filter((m): m is Record<string, unknown> => Boolean(m && typeof m === "object"))
        .map((m) => `${String(m.model ?? "?")}: ${fmtNum(m.credits, 1) ?? "?"} cr`)
        .join("; ");
      pushLine(lines, "Model mix (analytics)", breakdown || null);
    }
    const attr = ctxRecord(ctx.codeAttribution);
    if (attr) {
      const added = fmtNum(attr.linesAdded, 0);
      const removed = fmtNum(attr.linesRemoved, 0);
      if (added != null || removed != null) {
        pushLine(lines, "Code attribution", `+${added ?? "?"} / −${removed ?? "?"} lines`);
      }
    }
    pushLine(
      lines,
      "Model column",
      args.model
        ? `${args.model} (inferred for display — see model mix above for actual breakdown)`
        : null,
    );
    pushLine(
      lines,
      "Note",
      "One analytics bucket = aggregated Codex Enterprise usage for that user-day, not a single chat request.",
    );
    return lines;
  }

  if (args.ruleCode === "REGION_OUTSIDE_STRICT_ALLOWLIST" && ctx) {
    if (Array.isArray(ctx.allowedRegions)) {
      pushLine(lines, "Strict allowlist", ctx.allowedRegions.map(String).join(", "));
    }
    pushLine(
      lines,
      "Note",
      "Vendor feeds (Cursor/Codex) report region as global — not a cloud routing violation.",
    );
  }

  if (ctx && lines.length <= 1) {
    for (const [key, value] of Object.entries(ctx)) {
      if (value == null) continue;
      if (typeof value === "object") {
        pushLine(lines, key, JSON.stringify(value));
      } else {
        pushLine(lines, key, String(value));
      }
    }
  }

  return lines;
}
