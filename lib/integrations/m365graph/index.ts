import { getIntegrationMode, type IntegrationEnv } from "../env";
import { realM365GraphClient } from "./real";
import { syntheticM365GraphClient } from "./synthetic";
import type { M365GraphClient } from "./types";

export type { M365GraphClient, CopilotLicense, CopilotActivity } from "./types";

export function getM365GraphClient(env: IntegrationEnv = process.env): M365GraphClient {
  return getIntegrationMode("m365graph", env) === "real"
    ? realM365GraphClient
    : syntheticM365GraphClient;
}
