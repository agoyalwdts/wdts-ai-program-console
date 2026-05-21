import { truthyEnv } from "./resend-send";

/** Guardrail rule codes that trigger a direct coaching email to the end user. */
export const DEFAULT_GUARDRAIL_USER_COACHING_RULE_CODES = [
  "NON_COMPLEX_HEAVY_MODEL_SELECTED",
  "NON_COMPLEX_NON_DEFAULT_MODEL",
  "DAY_ONE_DISABLED_MODE_USED",
] as const;

export type AppEnvMode = "dev" | "sandbox" | "staging" | "prod";

export function appEnvMode(): AppEnvMode {
  const raw = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "dev").toLowerCase();
  if (raw.includes("prod")) return "prod";
  if (raw.includes("stag")) return "staging";
  if (raw.includes("sand")) return "sandbox";
  return "dev";
}

/** Master switch: `USER_MODEL_COACHING_EMAIL=1` */
export function isUserModelCoachingEmailEnabled(): boolean {
  return truthyEnv(process.env.USER_MODEL_COACHING_EMAIL);
}

/**
 * In dev/sandbox, user coaching is off unless `USER_MODEL_COACHING_ALLOW_DEV=1`
 * so local cron does not email real WDTS addresses by accident.
 */
export function allowUserCoachingInCurrentAppEnv(): boolean {
  const mode = appEnvMode();
  if (mode === "prod" || mode === "staging") return true;
  return truthyEnv(process.env.USER_MODEL_COACHING_ALLOW_DEV);
}

export function userCoachingEmailActive(): boolean {
  return isUserModelCoachingEmailEnabled() && allowUserCoachingInCurrentAppEnv();
}

export function guardrailRuleCodesForUserEmail(): Set<string> {
  const raw = process.env.GUARDRAIL_USER_COACHING_RULE_CODES?.trim();
  if (!raw) return new Set(DEFAULT_GUARDRAIL_USER_COACHING_RULE_CODES);
  return new Set(
    raw
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function userCoachingBccList(): string[] {
  const raw =
    process.env.USER_MODEL_COACHING_BCC?.trim() ??
    process.env.GUARDRAIL_ALERT_EMAIL_TO?.trim();
  if (!raw) return [];
  return raw
    .split(/[;,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
