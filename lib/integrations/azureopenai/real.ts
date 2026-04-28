/**
 * Real AzureOpenAIClient — calls the data-plane "list deployments"
 * endpoint on a specific Azure OpenAI resource. Authenticates with the
 * resource's API key (data plane). Switching to managed identity / AAD
 * auth comes when the dashboard moves into Azure App Service (scoping
 * §6 Q3); the only file to swap is this one.
 *
 * Endpoint:
 *   GET <endpoint>/openai/deployments?api-version=2023-05-15
 *   api-key: <key>
 */

import { IntegrationError } from "../errors";
import type { AzureOpenAIClient, AzureOpenAIDeployment } from "./types";

const API_VERSION = "2023-05-15";

type RawDeployment = {
  id: string;
  model: string;
  status: string;
  created_at?: number;
  scale_settings?: { capacity?: number; scale_type?: string };
};

function readEnv(env: Record<string, string | undefined> = process.env): {
  endpoint: string;
  apiKey: string;
} {
  const endpoint = env.AZURE_OPENAI_ENDPOINT;
  const apiKey = env.AZURE_OPENAI_API_KEY;
  if (!endpoint || !apiKey) {
    throw new IntegrationError(
      "azureopenai",
      "Missing AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY. Set them in " +
        ".env.local before flipping INTEGRATION_AZUREOPENAI=real.",
    );
  }
  // Tolerate trailing slashes; build a clean base URL.
  return { endpoint: endpoint.replace(/\/+$/, ""), apiKey };
}

function toDeployment(r: RawDeployment): AzureOpenAIDeployment {
  return {
    id: r.id,
    model: r.model,
    status: r.status,
    createdAt: r.created_at ? new Date(r.created_at * 1000) : new Date(0),
    capacity: r.scale_settings?.capacity,
  };
}

export const realAzureOpenAIClient: AzureOpenAIClient = {
  async listDeployments(): Promise<AzureOpenAIDeployment[]> {
    const { endpoint, apiKey } = readEnv();
    const url = `${endpoint}/openai/deployments?api-version=${API_VERSION}`;
    const r = await fetch(url, { headers: { "api-key": apiKey } });
    if (r.status === 401 || r.status === 403) {
      throw new IntegrationError(
        "azureopenai",
        `Azure OpenAI returned ${r.status}. Check AZURE_OPENAI_API_KEY and ` +
          `that the key matches the AZURE_OPENAI_ENDPOINT resource.`,
      );
    }
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new IntegrationError(
        "azureopenai",
        `Azure OpenAI list-deployments returned ${r.status}: ${text || r.statusText}`,
      );
    }
    const json = (await r.json()) as { data: RawDeployment[] };
    return (json.data ?? []).map(toDeployment);
  },
};
