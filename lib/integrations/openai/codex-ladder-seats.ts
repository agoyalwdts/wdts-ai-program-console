/**
 * Load F9 Codex ladder seats — live OpenAI org + Codex analytics in real mode,
 * Prisma licenses in synthetic. Omits seed-only orphans in real mode (mirrors F4).
 */

import {
  aggregateUserPostureFromBuckets,
  clipUsageBuckets,
  loadLatestCodexSessionsSnapshot,
  parseCodexSessionsSnapshotPayload,
} from "@/lib/analytics/codex-usage-posture";
import { formatLocalYmd } from "@/lib/f1-period";
import { prisma } from "@/lib/prisma";
import { startOfOpenAiChatGptCodexBillingPeriod } from "@/lib/openai-billing-period";
import { normCodexAnalyticsEmail } from "@/lib/integrations/codex-enterprise-analytics/aggregate-per-user-mtd";
import {
  fetchCodexEnterprisePerUserUsageRows,
  resolveCodexEnterpriseAnalyticsCredentials,
  resolveUsdPerCredit,
} from "@/lib/integrations/codex-enterprise-analytics/fetch-workspace-usage";
import { resolveCodexUsageRowEmail } from "@/lib/integrations/codex-enterprise-analytics/resolve-usage-row-identity";
import { registerCodexAnalyticsUserIdEmail } from "@/lib/guardrails/codex-user-id-keys";
import { SNAPSHOT_KIND_BY_EVENT_TYPE } from "@/lib/integrations/workspace-analytics/event-types";
import type { Fetch } from "../_http";
import { getIntegrationMode } from "../env";
import {
  mergeOrgUsersWithPrismaCodexSeats,
  type OrgMemberBrief,
} from "./merge-org-prisma-codex-seats";
import {
  loadChatGptWorkspaceRosterMembers,
} from "./chatgpt-workspace-roster";
import { listOpenAiOrgMembers } from "./org-users";
import {
  enrichCodexSeatsForDisplay,
  listCodexSeatsFromPrisma,
} from "./prisma-codex-seats";
import { syntheticOpenAIClient } from "./synthetic";
import type { CodexSeat } from "./types";

export type CodexLadderSource =
  | "synthetic_prisma"
  | "chatgpt_scim"
  | "chatgpt_workspace_export"
  | "openai_org"
  | "codex_analytics_snapshot"
  | "openai_org_and_analytics"
  | "chatgpt_workspace_roster"
  | "unavailable";

export type CodexLadderLoadResult = {
  seats: CodexSeat[];
  source: CodexLadderSource;
  warnings: string[];
  /** ChatGPT Enterprise workspace roster (SCIM / exports) — entitled headcount. */
  chatgptWorkspaceSeatCount: number;
  /** Users with Codex usage in the analytics lookback window. */
  codexActiveSeatCount: number;
};

const CODEX_ACTIVE_LOOKBACK_DAYS = 90;

function normEmail(e: string): string {
  return e.trim().toLowerCase();
}

function dedupeMembers(members: OrgMemberBrief[]): OrgMemberBrief[] {
  const byEmail = new Map<string, OrgMemberBrief>();
  for (const m of members) {
    const key = normEmail(m.email);
    if (!key.includes("@")) continue;
    if (!byEmail.has(key)) byEmail.set(key, m);
  }
  return [...byEmail.values()];
}

function membersFromSnapshotPayload(payload: unknown): OrgMemberBrief[] {
  const parsed = parseCodexSessionsSnapshotPayload(payload);
  if (!parsed) return [];
  const emails = new Set<string>();
  for (const b of parsed.usageBuckets ?? []) {
    if (b.email?.includes("@")) emails.add(normEmail(b.email));
  }
  for (const u of parsed.users ?? []) {
    if (u.email?.includes("@")) emails.add(normEmail(u.email));
  }
  return [...emails].map((email) => ({
    id: `analytics:${email}`,
    email,
    displayName: email,
  }));
}

async function loadAnalyticsSnapshotMembers(): Promise<{
  members: OrgMemberBrief[];
  warnings: string[];
}> {
  const snap = await loadLatestCodexSessionsSnapshot(prisma);
  if (!snap) {
    return { members: [], warnings: ["No CODEX_SESSIONS_JSON snapshot in ProgramVendorExportSnapshot."] };
  }
  const members = membersFromSnapshotPayload(snap.payload);
  if (members.length === 0) {
    return {
      members: [],
      warnings: [`Latest Codex snapshot (${snap.filename}) has no per-user emails.`],
    };
  }
  return { members, warnings: [] };
}

function buildUserIdToEmailFromMembers(members: OrgMemberBrief[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of members) {
    const email = normEmail(m.email);
    if (!email.includes("@")) continue;
    registerCodexAnalyticsUserIdEmail(map, m.id, email);
  }
  return map;
}

async function enrichUserIdMapFromWorkspaceAnalytics(
  userIdToEmail: Map<string, string>,
): Promise<void> {
  const snaps = await prisma.programVendorExportSnapshot.findMany({
    where: { kind: SNAPSHOT_KIND_BY_EVENT_TYPE.CHATGPT_USER_ANALYTICS },
    orderBy: { createdAt: "desc" },
    take: 45,
    select: { payload: true },
  });
  for (const snap of snaps) {
    const users = (snap.payload as { users?: { user_id?: string; email?: string }[] } | null)?.users;
    if (!Array.isArray(users)) continue;
    for (const u of users) {
      const userId = u.user_id?.trim();
      const email = u.email?.trim();
      if (!userId || !email?.includes("@")) continue;
      registerCodexAnalyticsUserIdEmail(userIdToEmail, userId, email);
    }
  }
}

/** Codex-active roster: live Enterprise Analytics API (90d), then snapshot fallback. */
async function loadCodexActiveMembers(args: {
  env: Record<string, string | undefined>;
  fetchImpl?: Fetch;
  identityMembers: OrgMemberBrief[];
}): Promise<{ members: OrgMemberBrief[]; warnings: string[] }> {
  const warnings: string[] = [];
  const creds = resolveCodexEnterpriseAnalyticsCredentials(args.env);

  if (creds) {
    try {
      const userIdToEmail = buildUserIdToEmailFromMembers(args.identityMembers);
      await enrichUserIdMapFromWorkspaceAnalytics(userIdToEmail);

      const endSec = Math.floor(Date.now() / 1000);
      const startSec = endSec - CODEX_ACTIVE_LOOKBACK_DAYS * 86_400;
      const rows = await fetchCodexEnterprisePerUserUsageRows({
        startTimeSec: startSec,
        endTimeSec: endSec,
        creds,
        fetchImpl: args.fetchImpl,
      });

      const byEmail = new Map<string, OrgMemberBrief>();
      for (const r of rows) {
        const email = resolveCodexUsageRowEmail(r, userIdToEmail);
        if (!email?.includes("@")) continue;
        const credits = r.totals?.credits ?? 0;
        if (credits <= 0) continue;
        if (!byEmail.has(email)) {
          byEmail.set(email, {
            id: `analytics-live:${email}`,
            email,
            displayName: email,
          });
        }
      }
      if (byEmail.size > 0) {
        return { members: [...byEmail.values()], warnings: [] };
      }
      warnings.push(
        `Codex Enterprise Analytics API returned no per-user usage in the last ${CODEX_ACTIVE_LOOKBACK_DAYS} days.`,
      );
    } catch (err) {
      warnings.push(
        `Codex analytics live roster failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return loadAnalyticsSnapshotMembers();
}

async function loadDashboardUserIdsByNormEmail(emails: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(emails.map(normEmail).filter(Boolean))];
  const chunkSize = 40;
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    const dbUsers = await prisma.user.findMany({
      where: {
        OR: chunk.map((e) => ({ email: { equals: e, mode: "insensitive" as const } })),
      },
      select: { id: true, email: true, displayName: true },
    });
    for (const u of dbUsers) {
      map.set(normEmail(u.email), u.id);
    }
  }
  return map;
}

async function applyDisplayNamesFromPrisma(members: OrgMemberBrief[]): Promise<OrgMemberBrief[]> {
  const emails = members.map((m) => m.email);
  const dashIds = await loadDashboardUserIdsByNormEmail(emails);
  if (dashIds.size === 0) return members;

  const ids = [...dashIds.values()];
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, email: true, displayName: true },
  });
  const nameByEmail = new Map<string, string>();
  for (const u of users) {
    nameByEmail.set(normEmail(u.email), u.displayName);
  }

  return members.map((m) => {
    const name = nameByEmail.get(normEmail(m.email));
    return name ? { ...m, displayName: name } : m;
  });
}

async function enrichCodexSeatsMtdFromSnapshot(
  seats: CodexSeat[],
  env: Record<string, string | undefined>,
): Promise<CodexSeat[]> {
  if (getIntegrationMode("codexenterprise", env) !== "real") return seats;
  const snap = await loadLatestCodexSessionsSnapshot(prisma);
  if (!snap) return seats;

  const parsed = parseCodexSessionsSnapshotPayload(snap.payload);
  if (!parsed?.usageBuckets?.length) return seats;

  const now = new Date();
  const clip = {
    start: formatLocalYmd(startOfOpenAiChatGptCodexBillingPeriod(now)),
    end: formatLocalYmd(now),
  };
  const clipped = clipUsageBuckets(parsed.usageBuckets, clip);
  if (clipped.length === 0) return seats;

  const postureByEmail = new Map<string, number>();
  for (const u of aggregateUserPostureFromBuckets(clipped)) {
    postureByEmail.set(normCodexAnalyticsEmail(u.email), u.credits_used);
  }
  const usdPerCredit = resolveUsdPerCredit(env);

  return seats.map((s) => {
    const credits = postureByEmail.get(normCodexAnalyticsEmail(s.email));
    if (credits == null) return s;
    const fromSnapshot = credits * usdPerCredit;
    return {
      ...s,
      mtdSpendUsd: Math.max(s.mtdSpendUsd, fromSnapshot),
    };
  });
}

function resolveSource(args: {
  scimCount: number;
  workspaceExportCount: number;
  orgCount: number;
  analyticsCount: number;
}): CodexLadderSource {
  const { scimCount, workspaceExportCount, orgCount, analyticsCount } = args;
  const hasWorkspace = scimCount > 0 || workspaceExportCount > 0;
  const hasOrg = orgCount > 0;
  const hasAnalytics = analyticsCount > 0;

  if (scimCount > 0 && !hasOrg && !hasAnalytics) return "chatgpt_scim";
  if (workspaceExportCount > 0 && !hasOrg && !hasAnalytics && scimCount === 0) {
    return "chatgpt_workspace_export";
  }
  if (hasWorkspace && (hasOrg || hasAnalytics)) return "chatgpt_workspace_roster";
  if (hasOrg && hasAnalytics) return "openai_org_and_analytics";
  if (hasOrg) return "openai_org";
  if (hasAnalytics) return "codex_analytics_snapshot";
  return "unavailable";
}

export async function loadCodexLadderSeats(args?: {
  env?: Record<string, string | undefined>;
  fetchImpl?: Fetch;
}): Promise<CodexLadderLoadResult> {
  const env = args?.env ?? process.env;
  const openAiReal = getIntegrationMode("openai", env) === "real";
  const codexAnalyticsReal = getIntegrationMode("codexenterprise", env) === "real";

  if (!openAiReal && !codexAnalyticsReal) {
    const seats = await syntheticOpenAIClient.listCodexSeats();
    return {
      seats,
      source: "synthetic_prisma",
      chatgptWorkspaceSeatCount: seats.length,
      codexActiveSeatCount: seats.length,
      warnings: [
        "INTEGRATION_OPENAI and INTEGRATION_CODEX_ENTERPRISE_ANALYTICS are not `real` — showing dev Prisma License rows.",
      ],
    };
  }

  const warnings: string[] = [];
  let orgMembers: OrgMemberBrief[] = [];
  let workspaceRoster = {
    members: [] as OrgMemberBrief[],
    scimCount: 0,
    csvSnapshotCount: 0,
    analyticsSnapshotCount: 0,
    warnings: [] as string[],
  };

  const [workspaceLoaded, orgResult] = await Promise.all([
    loadChatGptWorkspaceRosterMembers({
      prisma,
      env,
      fetchImpl: args?.fetchImpl,
    }),
    openAiReal
      ? listOpenAiOrgMembers({ env, fetchImpl: args?.fetchImpl })
          .then((members) => ({ members, error: null as string | null }))
          .catch((err) => ({
            members: [] as OrgMemberBrief[],
            error: err instanceof Error ? err.message : String(err),
          }))
      : Promise.resolve({ members: [] as OrgMemberBrief[], error: null }),
  ]);

  workspaceRoster = workspaceLoaded;
  warnings.push(...workspaceLoaded.warnings);
  orgMembers = orgResult.members;
  if (orgResult.error) {
    warnings.push(`OpenAI org users failed: ${orgResult.error}`);
  }

  const chatgptWorkspaceSeatCount = dedupeMembers(workspaceRoster.members).length;
  const identityMembers = dedupeMembers([...workspaceRoster.members, ...orgMembers]);

  const codexActiveLoaded = codexAnalyticsReal
    ? await loadCodexActiveMembers({
        env,
        fetchImpl: args?.fetchImpl,
        identityMembers,
      })
    : { members: [] as OrgMemberBrief[], warnings: [] as string[] };
  warnings.push(...codexActiveLoaded.warnings);
  const codexActiveMembers = codexActiveLoaded.members;
  const codexActiveSeatCount = codexActiveMembers.length;

  const rosterForLadder = codexAnalyticsReal
    ? codexActiveMembers
    : dedupeMembers([...workspaceRoster.members, ...orgMembers]);

  if (rosterForLadder.length === 0) {
    return {
      seats: [],
      source: "unavailable",
      chatgptWorkspaceSeatCount,
      codexActiveSeatCount,
      warnings: [
        ...warnings,
        codexAnalyticsReal
          ? "No Codex-active users in the analytics lookback window. Tier tables show Codex usage only — not the full ChatGPT workspace roster."
          : "No live Codex roster returned. Prisma seed licenses are not shown in real mode.",
      ],
    };
  }

  const prismaSeats = await listCodexSeatsFromPrisma();
  const licensedEmails = new Set(prismaSeats.map((s) => normEmail(s.email)));
  const membersWithNames = await applyDisplayNamesFromPrisma(rosterForLadder);
  const emailsForLookup = membersWithNames
    .map((m) => m.email)
    .filter((e) => {
      const k = normEmail(e);
      return k.length > 0 && !licensedEmails.has(k);
    });
  const dashboardUserIdByNormEmail = await loadDashboardUserIdsByNormEmail(emailsForLookup);

  const merged = mergeOrgUsersWithPrismaCodexSeats({
    orgMembers: membersWithNames,
    prismaSeats,
    dashboardUserIdByNormEmail,
    includePrismaOrphans: false,
    workspaceOnlyUserIdPrefix: "openai-workspace:",
  });

  const enriched = await enrichCodexSeatsForDisplay(merged);
  const seats = await enrichCodexSeatsMtdFromSnapshot(enriched, env);

  return {
    seats,
    source: resolveSource({
      scimCount: workspaceRoster.scimCount,
      workspaceExportCount:
        workspaceRoster.csvSnapshotCount + workspaceRoster.analyticsSnapshotCount,
      orgCount: orgMembers.length,
      analyticsCount: codexActiveSeatCount,
    }),
    chatgptWorkspaceSeatCount,
    codexActiveSeatCount,
    warnings,
  };
}
