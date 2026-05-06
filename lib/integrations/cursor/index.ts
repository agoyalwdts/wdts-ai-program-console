import { getIntegrationMode, type IntegrationEnv } from "../env";
import { realCursorClient } from "./real";
import { syntheticCursorClient } from "./synthetic";
import type { CursorClient } from "./types";

export type {
  CursorClient,
  CursorSeat,
  CursorSubTier,
  CursorWaitlistEntry,
  CursorWaitlistReason,
} from "./types";
export { makeRealCursorClient } from "./real";

export function getCursorClient(env: IntegrationEnv = process.env): CursorClient {
  if (getIntegrationMode("cursor", env) !== "real") {
    return syntheticCursorClient;
  }
  const base = env.CURSOR_SCIM_BASE_URL?.trim();
  const token =
    env.CURSOR_ADMIN_TOKEN?.trim() || env.CURSOR_TEAM_ADMIN_API_KEY?.trim();
  if (!base || !token) {
    return syntheticCursorClient;
  }
  return realCursorClient;
}
