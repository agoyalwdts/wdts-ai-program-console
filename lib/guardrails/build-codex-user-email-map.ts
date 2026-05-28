/**
 * Map Codex analytics `user_id` → email using OpenAI org/Codex seat roster.
 */

import { getOpenAIClient } from "@/lib/integrations";
import type { IntegrationEnv } from "@/lib/integrations/env";
import { normCodexAnalyticsEmail } from "@/lib/integrations/codex-enterprise-analytics/aggregate-per-user-mtd";

export async function buildCodexAnalyticsUserEmailMap(
  env?: IntegrationEnv,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const seats = await getOpenAIClient(env).listCodexSeats();
    for (const seat of seats) {
      const email = seat.email?.trim();
      if (!email?.includes("@")) continue;
      const norm = normCodexAnalyticsEmail(email);
      map.set(seat.userId, norm);
      if (seat.userId.startsWith("openai-org:")) {
        map.set(seat.userId.slice("openai-org:".length), norm);
      }
    }
  } catch (err) {
    console.error("[guardrails] buildCodexAnalyticsUserEmailMap failed", err);
  }
  return map;
}
