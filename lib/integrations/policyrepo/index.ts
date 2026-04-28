import { getIntegrationMode, type IntegrationEnv } from "../env";
import { realPolicyRepoClient } from "./real";
import { syntheticPolicyRepoClient } from "./synthetic";
import type { PolicyRepoClient } from "./types";

export type { PolicyRepoClient, PolicyChange, PolicyPullRequest } from "./types";

export function getPolicyRepoClient(env: IntegrationEnv = process.env): PolicyRepoClient {
  return getIntegrationMode("policyrepo", env) === "real"
    ? realPolicyRepoClient
    : syntheticPolicyRepoClient;
}
