/**
 * Map Codex analytics `user_id` → email from org roster, seats, and Workspace Analytics snapshots.
 */

import type { PrismaClient } from "@prisma/client";
import { getOpenAIClient } from "@/lib/integrations";
import type { IntegrationEnv } from "@/lib/integrations/env";
import { getIntegrationMode } from "@/lib/integrations/env";
import { SNAPSHOT_KIND_BY_EVENT_TYPE } from "@/lib/integrations/workspace-analytics/event-types";
import { registerCodexAnalyticsUserIdEmail } from "./codex-user-id-keys";

type WorkspaceAnalyticsSnapshotUser = {
  user_id?: string;
  email?: string;
};

async function mergeWorkspaceAnalyticsUserEmails(
  map: Map<string, string>,
  prisma: PrismaClient,
): Promise<number> {
  const snaps = await prisma.programVendorExportSnapshot.findMany({
    where: { kind: SNAPSHOT_KIND_BY_EVENT_TYPE.CHATGPT_USER_ANALYTICS },
    orderBy: { createdAt: "desc" },
    take: 45,
    select: { payload: true },
  });

  let linked = 0;
  for (const snap of snaps) {
    const users = (snap.payload as { users?: WorkspaceAnalyticsSnapshotUser[] } | null)?.users;
    if (!Array.isArray(users)) continue;
    for (const u of users) {
      const userId = u.user_id?.trim();
      const email = u.email?.trim();
      if (!userId || !email?.includes("@")) continue;
      const before = map.get(userId);
      registerCodexAnalyticsUserIdEmail(map, userId, email);
      if (!before && map.get(userId)) linked += 1;
    }
  }
  return linked;
}

/**
 * Build `user_id` → normalized email for Codex Enterprise Analytics bucket resolution.
 */
export async function buildCodexAnalyticsUserEmailMap(args?: {
  env?: IntegrationEnv;
  prisma?: PrismaClient;
}): Promise<Map<string, string>> {
  const env = args?.env ?? process.env;
  const map = new Map<string, string>();

  try {
    const client = getOpenAIClient(env);
    const [codexSeats, chatgptSeats] = await Promise.all([
      client.listCodexSeats(),
      client.listChatGptSeats().catch(() => []),
    ]);

    for (const seat of codexSeats) {
      const email = seat.email?.trim();
      if (!email?.includes("@")) continue;
      registerCodexAnalyticsUserIdEmail(map, seat.userId, email);
    }

    for (const seat of chatgptSeats) {
      const email = seat.email?.trim();
      if (!email?.includes("@")) continue;
      registerCodexAnalyticsUserIdEmail(map, seat.userId, email);
    }
  } catch (err) {
    console.error("[guardrails] buildCodexAnalyticsUserEmailMap roster failed", err);
  }

  if (args?.prisma && getIntegrationMode("openaicompliance", env) === "real") {
    try {
      const linked = await mergeWorkspaceAnalyticsUserEmails(map, args.prisma);
      if (linked > 0) {
        console.info(
          `[guardrails] Codex user_id map: +${linked} from CHATGPT_USER_ANALYTICS snapshots`,
        );
      }
    } catch (err) {
      console.error("[guardrails] buildCodexAnalyticsUserEmailMap workspace analytics failed", err);
    }
  }

  return map;
}
