import { getIntegrationMode, type IntegrationEnv } from "../env";
import { realCursorClient } from "./real";
import { syntheticCursorClient } from "./synthetic";
import type { CursorClient } from "./types";

export type { CursorClient, CursorSeat, CursorSubTier, CursorWaitlistEntry } from "./types";

export function getCursorClient(env: IntegrationEnv = process.env): CursorClient {
  return getIntegrationMode("cursor", env) === "real"
    ? realCursorClient
    : syntheticCursorClient;
}
