import { getIntegrationMode, type IntegrationEnv } from "../env";
import { realGatewayClient } from "./real";
import { syntheticGatewayClient } from "./synthetic";
import type { GatewayClient } from "./types";

export type { GatewayClient } from "./types";
export type {
  DailyProgramAggregate,
  ManagerQueueRow,
  ProgramAggregate,
  TopSpender,
  UsageAggregate,
  UsageDecision,
  UsageRecord,
} from "./types";

export function getGatewayClient(env: IntegrationEnv = process.env): GatewayClient {
  return getIntegrationMode("gateway", env) === "real"
    ? realGatewayClient
    : syntheticGatewayClient;
}
