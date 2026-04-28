import { getIntegrationMode, type IntegrationEnv } from "../env";
import { realAnthropicClient } from "./real";
import { syntheticAnthropicClient } from "./synthetic";
import type { AnthropicClient } from "./types";

export type { AnthropicClient, ClaudeSeat } from "./types";

export function getAnthropicClient(env: IntegrationEnv = process.env): AnthropicClient {
  return getIntegrationMode("anthropic", env) === "real"
    ? realAnthropicClient
    : syntheticAnthropicClient;
}
