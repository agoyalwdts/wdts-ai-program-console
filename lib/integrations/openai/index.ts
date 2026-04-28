import { getIntegrationMode, type IntegrationEnv } from "../env";
import { realOpenAIClient } from "./real";
import { syntheticOpenAIClient } from "./synthetic";
import type { OpenAIClient } from "./types";

export type { OpenAIClient, ChatGptSeat, CodexSeat, CodexSubTier } from "./types";
export { makeRealOpenAIClient } from "./real";

export function getOpenAIClient(env: IntegrationEnv = process.env): OpenAIClient {
  return getIntegrationMode("openai", env) === "real"
    ? realOpenAIClient
    : syntheticOpenAIClient;
}
