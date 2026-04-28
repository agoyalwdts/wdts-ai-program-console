import { getIntegrationMode, type IntegrationEnv } from "../env";
import { realDeelClient } from "./real";
import { syntheticDeelClient } from "./synthetic";
import type { DeelClient } from "./types";

export type { DeelClient, DeelEmployee, DeelWebhookEvent } from "./types";

export function getDeelClient(env: IntegrationEnv = process.env): DeelClient {
  return getIntegrationMode("deel", env) === "real"
    ? realDeelClient
    : syntheticDeelClient;
}
