import { getIntegrationMode, type IntegrationEnv } from "../env";
import { realDeelClient } from "./real";
import { syntheticDeelClient } from "./synthetic";
import type { DeelClient } from "./types";

export type { DeelClient, DeelEmployee, DeelWebhookEvent } from "./types";
export { makeRealDeelClient } from "./real";
export {
  parseDeelWebhook,
  verifyDeelSignature,
  type DeelWebhookEnvelope,
  type WebhookVerification,
} from "./webhook";

export function getDeelClient(env: IntegrationEnv = process.env): DeelClient {
  return getIntegrationMode("deel", env) === "real"
    ? realDeelClient
    : syntheticDeelClient;
}
