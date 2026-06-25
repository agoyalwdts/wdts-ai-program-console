/**
 * ChatGPT adoption signals from Workspace Analytics CHATGPT_USER_ANALYTICS snapshots.
 */

import type { PrismaClient } from "@prisma/client";
import { SNAPSHOT_KIND_BY_EVENT_TYPE } from "@/lib/integrations/workspace-analytics/event-types";
import type { ChatgptUserAnalyticsRow } from "@/lib/integrations/workspace-analytics/types";

export type ChatgptUserAdoptionRow = {
  email: string;
  name: string;
  creditsUsed: number;
  messages: number;
  gptMessages: number;
  projectMessages: number;
  toolMessages: number;
  lastDayActive: string | null;
  daysSeen: number;
  dormant: boolean;
};

export type ChatgptAdoptionSummary = {
  users: ChatgptUserAdoptionRow[];
  dormantCount: number;
  totalMessages: number;
  gptShare: number;
  projectShare: number;
  toolShare: number;
  snapshotDays: number;
};

const DORMANT_DAYS = 14;

function parseYmd(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function mergeUserAnalyticsRows(rows: ChatgptUserAnalyticsRow[]): ChatgptUserAdoptionRow[] {
  const byEmail = new Map<
    string,
    ChatgptUserAdoptionRow & { lastActiveDate: Date | null }
  >();

  for (const row of rows) {
    const email = row.email?.trim().toLowerCase();
    if (!email?.includes("@")) continue;
    let cur = byEmail.get(email);
    if (!cur) {
      cur = {
        email,
        name: row.name ?? "",
        creditsUsed: 0,
        messages: 0,
        gptMessages: 0,
        projectMessages: 0,
        toolMessages: 0,
        lastDayActive: row.last_day_active ?? null,
        daysSeen: 0,
        dormant: false,
        lastActiveDate: parseYmd(row.last_day_active ?? row.event_date),
      };
      byEmail.set(email, cur);
    }
    cur.creditsUsed += row.credits_used ?? 0;
    cur.messages += row.messages ?? 0;
    cur.gptMessages += row.gpt_messages ?? 0;
    cur.projectMessages += row.project_messages ?? 0;
    cur.toolMessages += row.tool_messages ?? 0;
    cur.daysSeen += 1;
    const lda = parseYmd(row.last_day_active ?? row.event_date);
    if (lda && (!cur.lastActiveDate || lda.getTime() > cur.lastActiveDate.getTime())) {
      cur.lastActiveDate = lda;
      cur.lastDayActive = row.last_day_active ?? row.event_date;
    }
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - DORMANT_DAYS);

  return [...byEmail.values()].map(({ lastActiveDate, ...rest }) => ({
    ...rest,
    dormant: !lastActiveDate || lastActiveDate.getTime() < cutoff.getTime(),
  }));
}

export function summarizeChatgptAdoption(users: ChatgptUserAdoptionRow[]): Omit<
  ChatgptAdoptionSummary,
  "users" | "snapshotDays"
> {
  const dormantCount = users.filter((u) => u.dormant).length;
  const gpt = users.reduce((s, u) => s + u.gptMessages, 0);
  const project = users.reduce((s, u) => s + u.projectMessages, 0);
  const tool = users.reduce((s, u) => s + u.toolMessages, 0);
  const totalMessages = users.reduce((s, u) => s + u.messages, 0);
  const mix = gpt + project + tool;
  return {
    dormantCount,
    totalMessages,
    gptShare: mix > 0 ? gpt / mix : 0,
    projectShare: mix > 0 ? project / mix : 0,
    toolShare: mix > 0 ? tool / mix : 0,
  };
}

export async function loadChatgptAdoptionSummary(
  prisma: PrismaClient,
  args: { periodStart: Date; periodEnd: Date },
): Promise<ChatgptAdoptionSummary | null> {
  const kind = SNAPSHOT_KIND_BY_EVENT_TYPE.CHATGPT_USER_ANALYTICS;
  const snaps = await prisma.programVendorExportSnapshot.findMany({
    where: {
      kind,
      periodStart: { gte: args.periodStart, lte: args.periodEnd },
    },
    orderBy: { createdAt: "desc" },
    select: { payload: true, periodStart: true },
    take: 120,
  });
  if (snaps.length === 0) return null;

  const allRows: ChatgptUserAnalyticsRow[] = [];
  const days = new Set<string>();
  for (const snap of snaps) {
    const day = snap.periodStart?.toISOString().slice(0, 10);
    if (day) days.add(day);
    const payload = snap.payload as {
      users?: Array<{
        user_id: string;
        email?: string;
        name?: string;
        credits_used?: number;
        messages?: number;
        gpt_messages?: number;
        project_messages?: number;
        tool_messages?: number;
        last_day_active?: string;
        event_date?: string;
      }>;
    } | null;
    for (const u of payload?.users ?? []) {
      allRows.push({
        event_id: u.user_id,
        event_date: u.event_date ?? day ?? "",
        user_id: u.user_id,
        email: u.email,
        name: u.name,
        credits_used: u.credits_used,
        messages: u.messages,
        gpt_messages: u.gpt_messages,
        project_messages: u.project_messages,
        tool_messages: u.tool_messages,
        last_day_active: u.last_day_active,
        raw: {},
      });
    }
  }

  const users = mergeUserAnalyticsRows(allRows).sort((a, b) => b.creditsUsed - a.creditsUsed);
  if (users.length === 0) return null;

  return {
    users,
    snapshotDays: days.size,
    ...summarizeChatgptAdoption(users),
  };
}
