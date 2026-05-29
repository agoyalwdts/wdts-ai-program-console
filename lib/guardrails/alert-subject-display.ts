const CODEX_ANALYTICS_RULE_CODES = new Set([
  "CODEX_HIGH_DAILY_CREDITS",
  "CODEX_ELEVATED_DAILY_CREDITS",
  "CODEX_MULTI_CLIENT_SURFACE",
]);

export function extractCodexUserIdFromContext(context: unknown): string | null {
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const c = context as Record<string, unknown>;
  const raw = c.codexUserId ?? c.codex_user_id;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

/** Legacy rows: subject key is the middle segment of the dedupe key. */
export function codexUserIdFromDedupeKey(ruleCode: string, dedupeKey: string): string | null {
  if (!CODEX_ANALYTICS_RULE_CODES.has(ruleCode)) return null;
  const parts = dedupeKey.split("|");
  if (parts.length < 3 || parts[0] !== ruleCode) return null;
  const key = parts[1]?.trim();
  if (!key || key === "unknown" || key.includes("@")) return null;
  return key;
}

export function guardrailAlertSubjectLabel(args: {
  userEmail: string | null;
  ruleCode: string;
  context?: unknown;
  dedupeKey?: string;
}): string {
  const email = args.userEmail?.trim();
  if (email) return email;

  const uid =
    extractCodexUserIdFromContext(args.context) ??
    (args.dedupeKey ? codexUserIdFromDedupeKey(args.ruleCode, args.dedupeKey) : null);
  if (uid) {
    const short = uid.length > 36 ? `${uid.slice(0, 34)}…` : uid;
    return `codex user ${short}`;
  }

  return "—";
}

export function guardrailAlertSubjectTitle(args: {
  userEmail: string | null;
  ruleCode: string;
  context?: unknown;
  dedupeKey?: string;
}): string | undefined {
  const email = args.userEmail?.trim();
  const uid =
    extractCodexUserIdFromContext(args.context) ??
    (args.dedupeKey ? codexUserIdFromDedupeKey(args.ruleCode, args.dedupeKey) : null);
  if (email && uid) return `email: ${email}\ncodex user_id: ${uid}`;
  if (uid) return `codex user_id: ${uid}`;
  return email ?? undefined;
}
