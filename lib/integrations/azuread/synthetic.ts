import { prisma } from "@/lib/prisma";
import type { AzureADClient, IdentityUser } from "./types";

function toIdentity(
  u: { id: string; email: string; displayName: string; status: string; managerId: string | null },
  managerEmailById: Map<string, string>,
): IdentityUser {
  let status: IdentityUser["status"] = "ACTIVE";
  if (u.status === "SUSPENDED" || u.status === "TERMINATED") status = u.status;
  return {
    email: u.email,
    displayName: u.displayName,
    azureObjectId: u.id,
    managerEmail: u.managerId ? managerEmailById.get(u.managerId) ?? null : null,
    status,
  };
}

export const syntheticAzureADClient: AzureADClient = {
  async listUsers(): Promise<IdentityUser[]> {
    const all = await prisma.user.findMany();
    const managerEmailById = new Map(all.map((u) => [u.id, u.email]));
    return all.map((u) => toIdentity(u, managerEmailById));
  },

  async getUserByEmail(email: string): Promise<IdentityUser | null> {
    const u = await prisma.user.findUnique({ where: { email } });
    if (!u) return null;
    const managerEmailById = new Map<string, string>();
    if (u.managerId) {
      const mgr = await prisma.user.findUnique({ where: { id: u.managerId } });
      if (mgr) managerEmailById.set(mgr.id, mgr.email);
    }
    return toIdentity(u, managerEmailById);
  },

  async getManager(email: string): Promise<IdentityUser | null> {
    const u = await prisma.user.findUnique({
      where: { email },
      include: { manager: true },
    });
    if (!u?.manager) return null;
    return toIdentity(u.manager, new Map());
  },
};
