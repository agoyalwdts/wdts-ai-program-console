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

export const syntheticOpenAIClient: OpenAIClient = {
  async listChatGptSeats(): Promise<ChatGptSeat[]> {
    const ls = await prisma.license.findMany({
      where: { product: "CHATGPT" },
      include: { user: true },
    });
    return ls.map((l) => ({
      userId: l.userId,
      email: l.user.email,
      capUsdMonth: l.capUsdMonth ?? 0,
    }));
  },

  async listCodexSeats(): Promise<CodexSeat[]> {
    const ls = await prisma.license.findMany({
      where: { product: "CODEX" },
      include: { user: true },
    });
    return ls.map((l) => ({
      userId: l.userId,
      email: l.user.email,
      subTier: asCodexSubTier(l.subTier),
      capUsdMonth: l.capUsdMonth ?? 0,
    }));
  },
};
