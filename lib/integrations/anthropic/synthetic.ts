import { prisma } from "@/lib/prisma";
import type { AnthropicClient, ClaudeSeat } from "./types";

export const syntheticAnthropicClient: AnthropicClient = {
  async listSeats(): Promise<ClaudeSeat[]> {
    const ls = await prisma.license.findMany({
      where: { product: "CLAUDE_AI" },
      include: { user: true },
    });
    return ls.map((l) => ({
      userId: l.userId,
      email: l.user.email,
      subTier: l.subTier,
      capUsdMonth: l.capUsdMonth ?? 0,
    }));
  },
};
