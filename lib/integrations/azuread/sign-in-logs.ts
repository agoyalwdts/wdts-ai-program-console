/**
 * Microsoft Entra sign-in logs (Graph `/auditLogs/signIns`) for ChatGPT / Codex / OpenAI SSO.
 * Requires `AuditLog.Read.All` (or Directory.Read.All) admin consent on the app registration.
 */

import { getIntegrationMode, type IntegrationEnv } from "../env";
import { graphPaginate, readGraphConfigFromEnv, type GraphConfig } from "./graph";

export type EntraSignInIpSummary =
  | {
      available: true;
      distinctIps: string[];
      signInCount: number;
      lookbackDays: number;
      matchedApps: string[];
    }
  | {
      available: false;
      reason: string;
    };

type GraphSignIn = {
  id?: string;
  createdDateTime?: string;
  userPrincipalName?: string;
  ipAddress?: string;
  appDisplayName?: string;
  resourceDisplayName?: string;
  clientAppUsed?: string;
  status?: { errorCode?: number };
};

const DEFAULT_LOOKBACK_DAYS = 30;
const MAX_PAGES = 20;

/** Substrings matched against appDisplayName / resourceDisplayName (case-insensitive). */
export const DEFAULT_ENTRA_AI_APP_PATTERNS = [
  "chatgpt",
  "openai",
  "codex",
  "gpt",
] as const;

function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseAppPatterns(env: IntegrationEnv): string[] {
  const raw = env.CHATGPT_CODEX_ENTRA_APP_PATTERNS?.trim();
  if (!raw) return [...DEFAULT_ENTRA_AI_APP_PATTERNS];
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function signInMatchesAiApp(signIn: GraphSignIn, patterns: string[]): boolean {
  const hay = [
    signIn.appDisplayName,
    signIn.resourceDisplayName,
    signIn.clientAppUsed,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!hay) return false;
  return patterns.some((p) => hay.includes(p));
}

function signInSucceeded(signIn: GraphSignIn): boolean {
  const code = signIn.status?.errorCode;
  return code === 0 || code === undefined;
}

/**
 * Distinct `ipAddress` values from Entra sign-ins to ChatGPT/Codex/OpenAI enterprise apps.
 */
export async function summarizeEntraAiSignInIpsForEmail(args: {
  email: string;
  lookbackDays?: number;
  env?: IntegrationEnv;
  cfg?: GraphConfig;
}): Promise<EntraSignInIpSummary> {
  const env = args.env ?? process.env;
  if (getIntegrationMode("azuread", env) !== "real") {
    return { available: false, reason: "INTEGRATION_AZUREAD is not real" };
  }

  const email = normEmail(args.email);
  if (!email.includes("@")) {
    return { available: false, reason: "Invalid email" };
  }

  let cfg: GraphConfig;
  try {
    cfg = args.cfg ?? readGraphConfigFromEnv(env);
  } catch (e) {
    return {
      available: false,
      reason: e instanceof Error ? e.message : "Azure AD Graph config missing",
    };
  }

  const lookbackDays = Math.min(Math.max(args.lookbackDays ?? DEFAULT_LOOKBACK_DAYS, 1), 30);
  const since = new Date(Date.now() - lookbackDays * 86_400_000);
  const sinceIso = since.toISOString();
  const patterns = parseAppPatterns(env);

  const ips = new Set<string>();
  const apps = new Set<string>();
  let signInCount = 0;

  const filter = encodeURIComponent(
    `userPrincipalName eq '${email.replace(/'/g, "''")}' and createdDateTime ge ${sinceIso}`,
  );
  const path = `/auditLogs/signIns?$filter=${filter}&$top=500&$orderby=createdDateTime desc`;

  let pages = 0;
  for await (const batch of graphPaginate<GraphSignIn>(cfg, path)) {
    pages += 1;
    if (pages > MAX_PAGES) break;
    for (const row of batch) {
      if (normEmail(row.userPrincipalName ?? "") !== email) continue;
      if (!signInSucceeded(row)) continue;
      if (!signInMatchesAiApp(row, patterns)) continue;
      signInCount += 1;
      const ip = row.ipAddress?.trim();
      if (ip) ips.add(ip);
      const app = row.appDisplayName?.trim();
      if (app) apps.add(app);
    }
  }

  return {
    available: true,
    distinctIps: [...ips].sort(),
    signInCount,
    lookbackDays,
    matchedApps: [...apps].sort(),
  };
}
