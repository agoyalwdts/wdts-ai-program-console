import { getIntegrationMode, type IntegrationEnv } from "../env";
import { realAzureADClient } from "./real";
import { syntheticAzureADClient } from "./synthetic";
import type { AzureADClient } from "./types";

export type { AzureADClient, IdentityUser } from "./types";

export function getAzureADClient(env: IntegrationEnv = process.env): AzureADClient {
  return getIntegrationMode("azuread", env) === "real"
    ? realAzureADClient
    : syntheticAzureADClient;
}
