import { Product, type PrismaClient } from "@prisma/client";
import { calendarDayAtNoonFromYmd } from "@/lib/imports/program-vendor-export/dates";
import { OPENAI_CREDIT_OVERAGE_USD } from "@/lib/program";
import type { WorkspaceAnalyticsEventType } from "./event-types";
import { SNAPSHOT_KIND_BY_EVENT_TYPE } from "./event-types";
import type {
  ChatgptGptAnalyticsRow,
  ChatgptProjectAnalyticsRow,
  ChatgptSurveyAnalyticsRow,
  ChatgptUserAnalyticsRow,
} from "./types";
import { WORKSPACE_ANALYTICS_USER_VENDOR_KEY } from "./vendor-key";

type UserSnapshotUser = {
  user_id: string;
  email: string;
  name: string;
  credits_used: number;
  messages: number;
  user_status: string;
};

function userRowToSnapshotUser(row: ChatgptUserAnalyticsRow): UserSnapshotUser | null {
  const email = row.email?.trim().toLowerCase();
  if (!email?.includes("@")) return null;
  return {
    user_id: row.user_id,
    email,
    name: row.name ?? "",
    credits_used: row.credits_used ?? 0,
    messages: row.messages ?? 0,
    user_status: row.user_status ?? "",
  };
}

async function loadExistingUsersForDay(
  prisma: PrismaClient,
  eventDate: string,
): Promise<Map<string, UserSnapshotUser>> {
  const snap = await prisma.programVendorExportSnapshot.findFirst({
    where: {
      kind: SNAPSHOT_KIND_BY_EVENT_TYPE.CHATGPT_USER_ANALYTICS,
      periodStart: calendarDayAtNoonFromYmd(eventDate),
      periodEnd: calendarDayAtNoonFromYmd(eventDate),
    },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  const map = new Map<string, UserSnapshotUser>();
  if (!snap?.payload || typeof snap.payload !== "object") return map;
  const users = (snap.payload as { users?: UserSnapshotUser[] }).users ?? [];
  for (const u of users) {
    if (u.user_id) map.set(u.user_id, u);
  }
  return map;
}

export async function ingestUserAnalyticsRows(
  prisma: PrismaClient,
  args: {
    rows: ChatgptUserAnalyticsRow[];
    actorEmail: string;
    filenamePrefix: string;
  },
): Promise<{ snapshotsWritten: number; vendorDaysUpserted: number }> {
  const byDate = new Map<string, ChatgptUserAnalyticsRow[]>();
  for (const row of args.rows) {
    const list = byDate.get(row.event_date) ?? [];
    list.push(row);
    byDate.set(row.event_date, list);
  }

  let snapshotsWritten = 0;
  let vendorDaysUpserted = 0;
  const now = new Date();

  for (const [eventDate, dayRows] of byDate) {
    const merged = await loadExistingUsersForDay(prisma, eventDate);
    for (const row of dayRows) {
      const u = userRowToSnapshotUser(row);
      if (u) merged.set(row.user_id, u);
    }
    const users = [...merged.values()];
    if (users.length === 0) continue;

    let totalCredits = 0;
    let totalMessages = 0;
    for (const u of users) {
      totalCredits += u.credits_used;
      totalMessages += u.messages;
    }

    await prisma.programVendorExportSnapshot.create({
      data: {
        kind: SNAPSHOT_KIND_BY_EVENT_TYPE.CHATGPT_USER_ANALYTICS,
        filename: `${args.filenamePrefix}-${eventDate}.jsonl`,
        periodStart: calendarDayAtNoonFromYmd(eventDate),
        periodEnd: calendarDayAtNoonFromYmd(eventDate),
        rowCount: users.length,
        actorEmail: args.actorEmail,
        payload: {
          source: "workspace_analytics_api",
          periodStart: eventDate,
          periodEnd: eventDate,
          totalCredits,
          totalMessages,
          userCount: users.length,
          users,
        },
      },
    });
    snapshotsWritten += 1;

    const spendUsd = totalCredits * OPENAI_CREDIT_OVERAGE_USD;
    if (spendUsd > 0) {
      const day = calendarDayAtNoonFromYmd(eventDate);
      await prisma.vendorDailySpend.upsert({
        where: {
          vendor_product_day: {
            vendor: WORKSPACE_ANALYTICS_USER_VENDOR_KEY,
            product: Product.CHATGPT,
            day,
          },
        },
        create: {
          vendor: WORKSPACE_ANALYTICS_USER_VENDOR_KEY,
          product: Product.CHATGPT,
          day,
          spendUsd,
          eventCount: users.length,
          syncedAt: now,
        },
        update: {
          spendUsd,
          eventCount: users.length,
          syncedAt: now,
        },
      });
      vendorDaysUpserted += 1;
    }
  }

  return { snapshotsWritten, vendorDaysUpserted };
}

async function ingestGenericRowsByDate<T extends { event_date: string; event_id: string }>(
  prisma: PrismaClient,
  args: {
    eventType: Exclude<
      WorkspaceAnalyticsEventType,
      "CHATGPT_USER_ANALYTICS"
    >;
    rows: T[];
    actorEmail: string;
    filenamePrefix: string;
    idField: keyof T;
  },
): Promise<number> {
  const kind = SNAPSHOT_KIND_BY_EVENT_TYPE[args.eventType];
  const byDate = new Map<string, T[]>();
  for (const row of args.rows) {
    const list = byDate.get(row.event_date) ?? [];
    list.push(row);
    byDate.set(row.event_date, list);
  }

  let snapshotsWritten = 0;
  for (const [eventDate, dayRows] of byDate) {
    const existing = await prisma.programVendorExportSnapshot.findFirst({
      where: {
        kind,
        periodStart: calendarDayAtNoonFromYmd(eventDate),
        periodEnd: calendarDayAtNoonFromYmd(eventDate),
      },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    const prevRows =
      (existing?.payload as { rows?: T[] } | null)?.rows?.filter(
        (r) => typeof r === "object" && r !== null,
      ) ?? [];
    const map = new Map<string, T>();
    for (const r of prevRows) {
      const id = String(r[args.idField]);
      if (id) map.set(id, r);
    }
    for (const r of dayRows) {
      map.set(String(r[args.idField]), r);
    }
    const rows = [...map.values()];

    await prisma.programVendorExportSnapshot.create({
      data: {
        kind,
        filename: `${args.filenamePrefix}-${eventDate}.jsonl`,
        periodStart: calendarDayAtNoonFromYmd(eventDate),
        periodEnd: calendarDayAtNoonFromYmd(eventDate),
        rowCount: rows.length,
        actorEmail: args.actorEmail,
        payload: {
          source: "workspace_analytics_api",
          periodStart: eventDate,
          periodEnd: eventDate,
          rows,
        },
      },
    });
    snapshotsWritten += 1;
  }
  return snapshotsWritten;
}

export function ingestProjectAnalyticsRows(
  prisma: PrismaClient,
  args: { rows: ChatgptProjectAnalyticsRow[]; actorEmail: string; filenamePrefix: string },
): Promise<number> {
  return ingestGenericRowsByDate(prisma, {
    eventType: "CHATGPT_PROJECT_ANALYTICS",
    rows: args.rows,
    actorEmail: args.actorEmail,
    filenamePrefix: args.filenamePrefix,
    idField: "project_id",
  });
}

export function ingestGptAnalyticsRows(
  prisma: PrismaClient,
  args: { rows: ChatgptGptAnalyticsRow[]; actorEmail: string; filenamePrefix: string },
): Promise<number> {
  return ingestGenericRowsByDate(prisma, {
    eventType: "CHATGPT_GPT_ANALYTICS",
    rows: args.rows,
    actorEmail: args.actorEmail,
    filenamePrefix: args.filenamePrefix,
    idField: "gpt_id",
  });
}

export function ingestSurveyAnalyticsRows(
  prisma: PrismaClient,
  args: { rows: ChatgptSurveyAnalyticsRow[]; actorEmail: string; filenamePrefix: string },
): Promise<number> {
  return ingestGenericRowsByDate(prisma, {
    eventType: "CHATGPT_SURVEY_ANALYTICS",
    rows: args.rows,
    actorEmail: args.actorEmail,
    filenamePrefix: args.filenamePrefix,
    idField: "event_id",
  });
}
