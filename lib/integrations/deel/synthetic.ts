import { prisma } from "@/lib/prisma";
import type { DeelClient, DeelEmployee } from "./types";

function toEmployee(
  u: {
    email: string;
    displayName: string;
    roleTag: string;
    region: string;
    status: string;
    managerId: string | null;
  },
  managerEmailById: Map<string, string>,
): DeelEmployee {
  let status: DeelEmployee["status"] = "ACTIVE";
  if (u.status === "SUSPENDED" || u.status === "TERMINATED") status = u.status;
  return {
    email: u.email,
    displayName: u.displayName,
    roleTag: u.roleTag,
    region: u.region,
    status,
    managerEmail: u.managerId ? managerEmailById.get(u.managerId) ?? null : null,
  };
}

export const syntheticDeelClient: DeelClient = {
  async listEmployees(): Promise<DeelEmployee[]> {
    const all = await prisma.user.findMany();
    const managerEmailById = new Map(all.map((u) => [u.id, u.email]));
    return all.map((u) => toEmployee(u, managerEmailById));
  },

  async getEmployeeByEmail(email: string): Promise<DeelEmployee | null> {
    const u = await prisma.user.findUnique({ where: { email }, include: { manager: true } });
    if (!u) return null;
    const m = new Map<string, string>();
    if (u.manager) m.set(u.manager.id, u.manager.email);
    return toEmployee(u, m);
  },
};
