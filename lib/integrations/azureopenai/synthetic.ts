import type { AzureOpenAIClient, AzureOpenAIDeployment } from "./types";

const NOW = new Date(Date.UTC(2026, 0, 15));

/**
 * Synthetic Azure OpenAI deployments — a deterministic fixture so the
 * /settings probe widget renders a non-empty list when the env points at
 * `synthetic`. Models match what a typical WDTS Cursor + Codex workload
 * would route through Azure if it ever did.
 */
const FIXTURE: AzureOpenAIDeployment[] = [
  {
    id: "gpt-4o-prod",
    model: "gpt-4o",
    status: "succeeded",
    createdAt: new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000),
    capacity: 30,
  },
  {
    id: "gpt-4o-mini-prod",
    model: "gpt-4o-mini",
    status: "succeeded",
    createdAt: new Date(NOW.getTime() - 45 * 24 * 60 * 60 * 1000),
    capacity: 60,
  },
  {
    id: "text-embedding-3-large",
    model: "text-embedding-3-large",
    status: "succeeded",
    createdAt: new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000),
  },
];

export const syntheticAzureOpenAIClient: AzureOpenAIClient = {
  async listDeployments() {
    return FIXTURE;
  },
};
