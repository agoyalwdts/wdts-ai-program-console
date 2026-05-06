/**
 * INTEGRATION_<NAME>=synthetic|real env-var parsing.
 *
 * Selection per scoping §4 ("Integration design principle"). Default is
 * `synthetic` for every client so dev / tests / demos never accidentally hit
 * a real vendor API. v0.2 staging/prod will set the relevant ones to `real`
 * once each integration is wired and the §8 N-series questions are cleared.
 */

import { IntegrationError } from "./errors";

export type IntegrationMode = "synthetic" | "real";

export type IntegrationName =
  | "gateway"
  | "cursor"
  | "openai"
  | "codexenterprise"
  | "anthropic"
  | "m365graph"
  | "azuread"
  | "deel"
  | "policyrepo"
  | "azureopenai";

export const INTEGRATION_NAMES: readonly IntegrationName[] = [
  "gateway",
  "cursor",
  "openai",
  "codexenterprise",
  "anthropic",
  "m365graph",
  "azuread",
  "deel",
  "policyrepo",
  "azureopenai",
] as const;

const ENV_KEY: Record<IntegrationName, string> = {
  gateway: "INTEGRATION_GATEWAY",
  cursor: "INTEGRATION_CURSOR",
  openai: "INTEGRATION_OPENAI",
  codexenterprise: "INTEGRATION_CODEX_ENTERPRISE_ANALYTICS",
  anthropic: "INTEGRATION_ANTHROPIC",
  m365graph: "INTEGRATION_M365GRAPH",
  azuread: "INTEGRATION_AZUREAD",
  deel: "INTEGRATION_DEEL",
  policyrepo: "INTEGRATION_POLICYREPO",
  azureopenai: "INTEGRATION_AZUREOPENAI",
};

/**
 * Relaxed env type — `NodeJS.ProcessEnv` requires `NODE_ENV` which makes
 * test ergonomics painful. We only ever read `INTEGRATION_*` keys here.
 */
export type IntegrationEnv = Record<string, string | undefined>;

export function getIntegrationMode(
  name: IntegrationName,
  env: IntegrationEnv = process.env,
): IntegrationMode {
  const raw = env[ENV_KEY[name]];
  if (raw == null || raw === "") return "synthetic";
  const v = raw.toLowerCase();
  if (v === "synthetic" || v === "real") return v;
  throw new IntegrationError(
    name,
    `${ENV_KEY[name]}=${raw} is invalid; expected 'synthetic' or 'real'.`,
  );
}

export function getAllIntegrationModes(
  env: IntegrationEnv = process.env,
): Record<IntegrationName, IntegrationMode> {
  const out = {} as Record<IntegrationName, IntegrationMode>;
  for (const name of INTEGRATION_NAMES) out[name] = getIntegrationMode(name, env);
  return out;
}
