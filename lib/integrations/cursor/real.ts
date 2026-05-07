/**
 * Real CursorClient — F4 "filled" seats union **SCIM workspace members** with
 * **Prisma `License` (CURSOR)**. Email match → program tier / MTD / idle from
 * the mirror; SCIM-only members → STANDARD placeholder so the board reflects
 * actual workspace size. If SCIM env is unset or SCIM fails, falls back to
 * Prisma-only (program allocation).
 */

import type { Fetch } from "../_http";
import type { CursorClient, CursorWaitlistEntry } from "./types";
import { mergeScimMembersWithPrismaSeats } from "./merge-scim-prisma-seats";
import { listCursorSeatsFromPrisma } from "./prisma-cursor-seats";
import { listScimUsers, readScimEnv } from "./scim-list-users";

export function makeRealCursorClient(opts?: {
  fetchImpl?: Fetch;
  env?: Record<string, string | undefined>;
}): CursorClient {
  const env = opts?.env ?? process.env;
  const fetchImpl = opts?.fetchImpl;
  return {
    async listSeats() {
      const prismaSeats = await listCursorSeatsFromPrisma();
      const scimEnv = readScimEnv(env);
      if (!scimEnv) return prismaSeats;
      try {
        const scimMembers = await listScimUsers(scimEnv, fetchImpl);
        return mergeScimMembersWithPrismaSeats(scimMembers, prismaSeats);
      } catch (err) {
        console.error("[cursor/real] SCIM listUsers failed; using Prisma seats only", err);
        return prismaSeats;
      }
    },

    async listWaitlist(): Promise<CursorWaitlistEntry[]> {
      return [];
    },
  };
}

export const realCursorClient = makeRealCursorClient();
