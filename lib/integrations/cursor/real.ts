/**
 * Real CursorClient — delegates to {@link loadCursorWorkspaceSeats} for live
 * Team Admin + SCIM roster (no Prisma seed fallback in real mode).
 */

import type { Fetch } from "../_http";
import type { CursorClient, CursorWaitlistEntry } from "./types";
import { loadCursorWorkspaceSeats } from "./workspace-seats";

export function makeRealCursorClient(opts?: {
  fetchImpl?: Fetch;
  env?: Record<string, string | undefined>;
}): CursorClient {
  const env = opts?.env ?? process.env;
  const fetchImpl = opts?.fetchImpl;
  return {
    async listSeats() {
      const { seats } = await loadCursorWorkspaceSeats({ env, fetchImpl });
      return seats;
    },

    async listWaitlist(): Promise<CursorWaitlistEntry[]> {
      return [];
    },
  };
}

export const realCursorClient = makeRealCursorClient();
