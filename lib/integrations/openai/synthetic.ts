import { prisma } from "@/lib/prisma";
import type { ChatGptSeat, CodexSeat, CodexSubTier, OpenAIClient } from "./types";

function asCodexSubTier(s: string): CodexSubTier {
  switch (s) {
    case "codex_power":
      return "POWER";
    case "codex_standard":
      return "STANDARD";
    case "codex_light":
      return "LIGHT";
    case "codex_discovery":
      return "DISCOVERY";
    default:
      throw new Error(`Unknown Codex sub-tier from DB: ${s}`);
  }
}

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

  async listCodexSeats(): Promise<CodexSeat[]> {
    const [ls, { mtdMap, lastSeenMap }] = await Promise.all([
      prisma.license.findMany({ where: { product: "CODEX" }, include: { user: true } }),
      mtdAndLastActivityByUser("CODEX"),
    ]);
    const now = new Date();
    return ls.map((l) => {
      const last = lastSeenMap.get(l.userId) ?? null;
      const idleDays = last
        ? Math.max(
            0,
            Math.floor((now.getTime() - new Date(last).getTime()) / (24 * 60 * 60 * 1000)),
          )
        : null;
      return {
        userId: l.userId,
        email: l.user.email,
        displayName: l.user.displayName,
        subTier: asCodexSubTier(l.subTier),
        capUsdMonth: l.capUsdMonth ?? 0,
        mtdSpendUsd: mtdMap.get(l.userId) ?? 0,
        lastActivityTs: last,
        idleDays,
      };
    });
  },
};
