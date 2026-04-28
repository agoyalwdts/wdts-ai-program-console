/**
 * AzureOpenAIClient — connectivity + deployment-inventory probe for an
 * Azure OpenAI resource.
 *
 * NOT to be confused with `OpenAIClient` (admin API for ChatGPT / Codex
 * seats and tiers). Azure OpenAI is a separate service: the user
 * provisions a Cognitive Services resource and deploys specific models
 * (gpt-4o, o3, etc.) into named "deployments". This client surfaces
 * those deployments so /settings can show "we're configured to call
 * gpt-4o via the `anuj-openai-instance` resource."
 *
 * Refs:
 *  - https://learn.microsoft.com/azure/ai-services/openai/reference#list-deployments
 *  - Dashboard_Scoping_v1.md §4 (integration design principle).
 */

export type AzureOpenAIDeployment = {
  /** Deployment name (the user-facing handle, e.g. "gpt-4o-prod"). */
  id: string;
  /** Underlying model the deployment serves (e.g. "gpt-4o"). */
  model: string;
  /** Current provisioning state: "succeeded" | "failed" | "creating" | ... */
  status: string;
  createdAt: Date;
  /** Provisioned throughput units, if applicable. */
  capacity?: number;
};

export type AzureOpenAIClient = {
  /** Returns the deployments configured on the resource. */
  listDeployments(): Promise<AzureOpenAIDeployment[]>;
};
