/**
 * Real CursorClient — F4 seat board reads dashboard `License` rows (product
 * CURSOR) plus usage aggregates, matching the synthetic client's shape. SCIM
 * workspace membership is optional and not required for this view; the board
 * reflects program allocation in Postgres (seed / reconcilers / imports), not
 * vendor-reported seat count alone.
 *
 * `listWaitlist()` returns `[]` — the waitlist is dashboard-local; the
 * synthetic client still materialises a stub from Prisma for dev UX.
 */

import type { CursorClient, CursorWaitlistEntry } from "./types";
import { listCursorSeatsFromPrisma } from "./prisma-cursor-seats";

export function makeRealCursorClient(): CursorClient {
  return {
    async listSeats() {
      return listCursorSeatsFromPrisma();
    },

    async listWaitlist(): Promise<CursorWaitlistEntry[]> {
      return [];
    },
  };
}

export const realCursorClient = makeRealCursorClient();
