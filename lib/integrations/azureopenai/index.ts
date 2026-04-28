import { getIntegrationMode, type IntegrationEnv } from "../env";
import { realAzureOpenAIClient } from "./real";
import { syntheticAzureOpenAIClient } from "./synthetic";
import type { AzureOpenAIClient } from "./types";

export type { AzureOpenAIClient, AzureOpenAIDeployment } from "./types";

export function getAzureOpenAIClient(
  env: IntegrationEnv = process.env,
): AzureOpenAIClient {
  return getIntegrationMode("azureopenai", env) === "real"
    ? realAzureOpenAIClient
    : syntheticAzureOpenAIClient;
}
