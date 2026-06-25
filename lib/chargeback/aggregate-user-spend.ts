/**
 * F10 chargeback — batch per-user spend from vendor mirrors with gateway fallback.
 * Mirrors the Users page merge (Cursor Team Admin, ChatGPT snapshots, Codex posture,
 * Unified Credits COSTS when synced).
 */

import { Product, type PrismaClient } from "@prisma/client";
import { inclusiveDayCountYmd } from "@/lib/imports/program-vendor-export/dates";
import { buildCodexUsagePostureView } from "@/lib/analytics/codex-usage-posture";
import { formatLocalYmd } from "@/lib/f1-period";
import { getIntegrationMode } from "@/lib/integrations/env";
import {
  CURSOR_TEAM_ADMIN_VENDOR_KEY,
  normCursorUserEmail,
} from "@/lib/integrations/cursor/team-admin-usage";
import { UNIFIED_CREDITS_VENDOR_KEY } from "@/lib/integrations/unified-credits/constants";
import { loadUnifiedCreditsBreakdown } from "@/lib/analytics/unified-credits-breakdown";
import { WORKSPACE_ANALYTICS_USER_VENDOR_KEY } from "@/lib/integrations/workspace-analytics/vendor-key";
import type { UsageAggregate } from "@/lib/integrations/gateway/types";
import { OPENAI_CREDIT_OVERAGE_USD, type ProductKey } from "@/lib/program";

export type UserSpendByProduct = Record<ProductKey, number>;

export type ChargebackSpendMeta = {
  usedVendorMirror: boolean;
  /** Human-readable labels for the page subtitle. */
  dataSources: string[];
  /** Top Unified Credits SKU in window (when COSTS snapshots exist). */
  topUnifiedCreditsSku?: string;
};

function vendorDayRange(periodStart: Date, periodEnd: Date): {
  rangeStart: Date;
  rangeEnd: Date;
} {
  const startDay = new Date(periodStart);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(periodEnd);
  endDay.setHours(0, 0, 0, 0);
  return {
    rangeStart: new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate(), 12, 0, 0, 0),
    rangeEnd: new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate(), 12, 0, 0, 0),
  };
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function overlapInclusiveDays(planStart: Date, planEnd: Date, expStart: Date, expEnd: Date): number {
  const a0 = startOfLocalDay(planStart);
  const a1 = startOfLocalDay(planEnd);
  const b0 = startOfLocalDay(expStart);
  const b1 = startOfLocalDay(expEnd);
  const lo = a0.getTime() > b0.getTime() ? a0 : b0;
  const hi = a1.getTime() < b1.getTime() ? a1 : b1;
  if (lo.getTime() > hi.getTime()) return 0;
  return inclusiveDayCountYmd(formatLocalYmd(lo), formatLocalYmd(hi));
}

function normEmail(e: string): string {
  return e.trim().toLowerCase();
}

export function emptyProductSpend(): UserSpendByProduct {
  const m = {} as UserSpendByProduct;
  for (const key of ["CURSOR", "CHATGPT", "CODEX", "CLAUDE_AI", "M365_COPILOT"] as ProductKey[]) {
    m[key] = 0;
  }
  return m;
}

function bumpProduct(
  row: UserSpendByProduct,
  product: ProductKey,
  usd: number,
): boolean {
  if (!Number.isFinite(usd) || usd <= 0) return false;
  if (usd >= row[product]) {
    row[product] = usd;
    return true;
  }
  return false;
}

function productKeyFromPrisma(product: Product): ProductKey | null {
  const k = product as ProductKey;
  if (k === "CURSOR" || k === "CHATGPT" || k === "CODEX" || k === "CLAUDE_AI" || k === "M365_COPILOT") {
    return k;
  }
  return null;
}

/** Vendor priority per product — later entries win over earlier when both have spend. */
const VENDOR_PRIORITY: Partial<Record<ProductKey, string[]>> = {
  CURSOR: [CURSOR_TEAM_ADMIN_VENDOR_KEY],
  CHATGPT: [
    WORKSPACE_ANALYTICS_USER_VENDOR_KEY,
    UNIFIED_CREDITS_VENDOR_KEY,
  ],
  CODEX: [UNIFIED_CREDITS_VENDOR_KEY],
};

function pickPreferredVendor(
  byVendor: Map<string, number>,
  priority: string[],
): { vendor: string | null; usd: number } {
  for (let i = priority.length - 1; i >= 0; i--) {
    const vendor = priority[i]!;
    const usd = byVendor.get(vendor) ?? 0;
    if (usd > 0) return { vendor, usd };
  }
  let bestUsd = 0;
  let bestVendor: string | null = null;
  for (const [vendor, usd] of byVendor) {
    if (usd > bestUsd) {
      bestUsd = usd;
      bestVendor = vendor;
    }
  }
  return { vendor: bestVendor, usd: bestUsd };
}

async function batchChatGptUsdFromSnapshots(
  prisma: PrismaClient,
  periodStart: Date,
  periodEnd: Date,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const snaps = await prisma.programVendorExportSnapshot.findMany({
    where: { kind: { in: ["CHATGPT_USERS_CSV", "CHATGPT_USER_ANALYTICS"] } },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { periodStart: true, periodEnd: true, payload: true },
  });

  for (const snap of snaps) {
    if (!snap.periodStart || !snap.periodEnd) continue;
    const overlap = overlapInclusiveDays(periodStart, periodEnd, snap.periodStart, snap.periodEnd);
    if (overlap <= 0) continue;
    const exportDays = inclusiveDayCountYmd(
      formatLocalYmd(snap.periodStart),
      formatLocalYmd(snap.periodEnd),
    );
    if (exportDays <= 0) continue;

    const users =
      (snap.payload as { users?: { email: string; credits_used: number }[] }).users ?? [];
    for (const u of users) {
      const email = normEmail(u.email);
      const credits =
        typeof u.credits_used === "number" ? u.credits_used : Number(u.credits_used);
      if (!Number.isFinite(credits) || credits <= 0) continue;
      const usd = credits * OPENAI_CREDIT_OVERAGE_USD * (overlap / exportDays);
      const prev = result.get(email) ?? 0;
      if (usd > prev) result.set(email, usd);
    }
  }
  return result;
}

async function batchCodexUsdFromSnapshot(
  prisma: PrismaClient,
  periodStart: Date,
  periodEnd: Date,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const snap = await prisma.programVendorExportSnapshot.findFirst({
    where: { kind: "CODEX_SESSIONS_JSON" },
    orderBy: { createdAt: "desc" },
    select: { payload: true, periodStart: true, periodEnd: true },
  });
  if (!snap?.payload) return result;

  const view = buildCodexUsagePostureView({
    payload: snap.payload,
    clip: { start: formatLocalYmd(periodStart), end: formatLocalYmd(periodEnd) },
    snapshotPeriodStart: snap.periodStart ? formatLocalYmd(snap.periodStart) : null,
    snapshotPeriodEnd: snap.periodEnd ? formatLocalYmd(snap.periodEnd) : null,
  });
  if (!view) return result;

  for (const u of view.topUsers) {
    const email = normEmail(u.email);
    const usd = u.credits_used * OPENAI_CREDIT_OVERAGE_USD;
    if (usd > 0) result.set(email, usd);
  }
  return result;
}

export async function aggregateChargebackSpendByUserId(args: {
  prisma: PrismaClient;
  gatewayAggs: UsageAggregate[];
  emailToUserId: Map<string, string>;
  periodStart: Date;
  periodEnd: Date;
}): Promise<{ spendByUserId: Map<string, UserSpendByProduct>; meta: ChargebackSpendMeta }> {
  const spendByUserId = new Map<string, UserSpendByProduct>();
  const dataSources = new Set<string>(["gateway UsageRecord mirror"]);
  let usedVendorMirror = false;

  function getOrCreate(userId: string): UserSpendByProduct {
    let row = spendByUserId.get(userId);
    if (!row) {
      row = emptyProductSpend();
      spendByUserId.set(userId, row);
    }
    return row;
  }

  for (const a of args.gatewayAggs) {
    const product = a.product as ProductKey;
    const row = getOrCreate(a.userId);
    row[product] = (row[product] ?? 0) + a.totalUsd;
  }

  const { rangeStart, rangeEnd } = vendorDayRange(args.periodStart, args.periodEnd);

  const vendorGrouped = await args.prisma.vendorUserDailySpend.groupBy({
    by: ["userEmail", "product", "vendor"],
    where: { day: { gte: rangeStart, lte: rangeEnd } },
    _sum: { spendUsd: true },
  });

  /** email → product → vendor → usd */
  const vendorTotals = new Map<string, Map<ProductKey, Map<string, number>>>();
  for (const g of vendorGrouped) {
    const product = productKeyFromPrisma(g.product);
    if (!product) continue;
    const email = normEmail(g.userEmail);
    const usd = g._sum.spendUsd ?? 0;
    if (usd <= 0) continue;
    let byProduct = vendorTotals.get(email);
    if (!byProduct) {
      byProduct = new Map();
      vendorTotals.set(email, byProduct);
    }
    let byVendor = byProduct.get(product);
    if (!byVendor) {
      byVendor = new Map();
      byProduct.set(product, byVendor);
    }
    byVendor.set(g.vendor, (byVendor.get(g.vendor) ?? 0) + usd);
  }

  if (vendorGrouped.length > 0) {
    usedVendorMirror = true;
    dataSources.add("VendorUserDailySpend");
  }

  if (getIntegrationMode("cursor") === "real") {
    dataSources.add("Cursor Team Admin API");
  }
  dataSources.add("ChatGPT workspace analytics snapshots");
  dataSources.add("Codex sessions snapshot");
  dataSources.add("OpenAI Unified Credits COSTS (when synced)");

  const [chatgptByEmail, codexByEmail, unifiedBreakdown] = await Promise.all([
    batchChatGptUsdFromSnapshots(args.prisma, args.periodStart, args.periodEnd),
    batchCodexUsdFromSnapshot(args.prisma, args.periodStart, args.periodEnd),
    loadUnifiedCreditsBreakdown(args.prisma, {
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
    }),
  ]);

  if (unifiedBreakdown?.bySku[0]) {
    dataSources.add(
      `Unified Credits top SKU: ${unifiedBreakdown.bySku[0].key} (${unifiedBreakdown.bySku[0].credits.toLocaleString()} credits)`,
    );
  }

  if (chatgptByEmail.size > 0) usedVendorMirror = true;
  if (codexByEmail.size > 0) usedVendorMirror = true;

  const allEmails = new Set<string>([
    ...vendorTotals.keys(),
    ...chatgptByEmail.keys(),
    ...codexByEmail.keys(),
  ]);

  for (const email of allEmails) {
    const userId = args.emailToUserId.get(email);
    if (!userId) continue;
    const row = getOrCreate(userId);

    const chatgptUsd = chatgptByEmail.get(email);
    if (chatgptUsd != null) bumpProduct(row, "CHATGPT", chatgptUsd);

    const codexUsd = codexByEmail.get(email);
    if (codexUsd != null) bumpProduct(row, "CODEX", codexUsd);

    const byProduct = vendorTotals.get(email);
    if (byProduct) {
      for (const [product, byVendor] of byProduct) {
        const priority = VENDOR_PRIORITY[product] ?? [];
        const { usd } = pickPreferredVendor(byVendor, priority);
        if (usd > 0 && bumpProduct(row, product, usd)) {
          usedVendorMirror = true;
        }
      }
    }

    // Cursor vendor rows use normCursorUserEmail in mirror — re-check with cursor norm.
    if (getIntegrationMode("cursor") === "real") {
      const cursorEmail = normCursorUserEmail(email);
      if (cursorEmail && cursorEmail !== email) {
        const alt = vendorTotals.get(cursorEmail);
        const cursorUsd = alt?.get("CURSOR")?.get(CURSOR_TEAM_ADMIN_VENDOR_KEY);
        if (cursorUsd != null && cursorUsd > 0) {
          bumpProduct(row, "CURSOR", cursorUsd);
          usedVendorMirror = true;
        }
      }
    }
  }

  // Prefer vendor totals over gateway when higher (same rule as Users page).
  for (const a of args.gatewayAggs) {
    const row = spendByUserId.get(a.userId);
    if (!row) continue;
    const product = a.product as ProductKey;
    if ((row[product] ?? 0) < a.totalUsd) row[product] = a.totalUsd;
  }

  return {
    spendByUserId,
    meta: {
      usedVendorMirror,
      dataSources: [...dataSources],
      topUnifiedCreditsSku: unifiedBreakdown?.bySku[0]?.key,
    },
  };
}

export function totalSpendForUser(row: UserSpendByProduct): number {
  return Object.values(row).reduce((s, v) => s + v, 0);
}
