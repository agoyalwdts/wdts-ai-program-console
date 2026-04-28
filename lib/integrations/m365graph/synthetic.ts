/**
 * Synthetic M365GraphClient — license list comes from the dev DB; activity
 * is left empty (the v0.1 schema doesn't carry per-feature interaction
 * counts; v0.2 will add a CopilotActivity model when F13 starts).
 */

import { prisma } from "@/lib/prisma";
import type { CopilotActivity, CopilotLicense, M365GraphClient } from "./types";

export const syntheticM365GraphClient: M365GraphClient = {
  async listLicenses(): Promise<CopilotLicense[]> {
    const ls = await prisma.license.findMany({
      where: { product: "M365_COPILOT" },
      include: { user: true },
    });
    return ls.map((l) => ({
      userId: l.userId,
      email: l.user.email,
      flag: l.flag,
    }));
  },

  async listActivity(): Promise<CopilotActivity[]> {
    return [];
  },
};
