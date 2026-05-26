import { readGraphConfigFromEnv } from "@/lib/integrations/azuread/graph";
import type { EmailProvider } from "./email-types";
import { isResendConfigured } from "./resend-send";

export function hasAzureGraphMailCredentials(
  env: Record<string, string | undefined> = process.env,
): boolean {
  try {
    readGraphConfigFromEnv(env);
    return Boolean(env.GRAPH_MAIL_SENDER?.trim());
  } catch {
    return false;
  }
}

export function emailProvider(
  env: Record<string, string | undefined> = process.env,
): EmailProvider {
  const raw = env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (raw === "graph" || raw === "resend") return raw;
  if (hasAzureGraphMailCredentials(env)) return "graph";
  return "resend";
}

export function isEmailConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (emailProvider(env) === "graph") return hasAzureGraphMailCredentials(env);
  return isResendConfigured();
}

export function defaultEmailFrom(
  env: Record<string, string | undefined> = process.env,
): string {
  const explicit =
    env.GUARDRAIL_ALERT_EMAIL_FROM?.trim() ?? env.CURSOR_ALERT_EMAIL_FROM?.trim();
  if (explicit) return explicit;
  if (emailProvider(env) === "graph") {
    const sender = env.GRAPH_MAIL_SENDER!.trim();
    return `WDTS AI Console <${sender}>`;
  }
  return "WDTS AI Console <onboarding@resend.dev>";
}
