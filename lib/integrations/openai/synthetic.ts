import { prisma } from "@/lib/prisma";
import { listCodexSeatsFromPrisma } from "./prisma-codex-seats";
import type { ChatGptSeat, OpenAIClient } from "./types";

async function mtdAndLastActivityByUser(product: "CHATGPT" | "CODEX") {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [mtd, last] = await Promise.all([
    prisma.usageRecord.groupBy({
      by: ["userId"],
      where: { product, ts: { gte: startOfMonth }, decision: { in: ["ALLOWED", "PROMPTED"] } },
      _sum: { costUsd: true },
    }),
    prisma.usageRecord.groupBy({
      by: ["userId"],
      where: { product, decision: { in: ["ALLOWED", "PROMPTED"] } },
      _max: { ts: true },
    }),
  ]);

  return {
    mtdMap: new Map(mtd.map((r) => [r.userId, r._sum.costUsd ?? 0])),
    lastSeenMap: new Map(last.map((r) => [r.userId, r._max.ts ?? null])),
  };
}

export const syntheticOpenAIClient: OpenAIClient = {
  async listChatGptSeats(): Promise<ChatGptSeat[]> {
    const [ls, { mtdMap }] = await Promise.all([
      prisma.license.findMany({ where: { product: "CHATGPT" }, include: { user: true } }),
      mtdAndLastActivityByUser("CHATGPT"),
    ]);
    return ls.map((l) => ({
      userId: l.userId,
      email: l.user.email,
      displayName: l.user.displayName,
      capUsdMonth: l.capUsdMonth ?? 0,
      mtdSpendUsd: mtdMap.get(l.userId) ?? 0,
    }));
  },

  async listCodexSeats() {
    return listCodexSeatsFromPrisma();
  },
};
