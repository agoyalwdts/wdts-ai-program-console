import { Product, type PrismaClient } from "@prisma/client";
import { calendarDayAtNoonFromYmd } from "@/lib/imports/program-vendor-export/dates";
import { OPENAI_CREDIT_OVERAGE_USD } from "@/lib/program";
import { UNIFIED_CREDITS_SNAPSHOT_KIND, UNIFIED_CREDITS_VENDOR_KEY } from "./constants";
import type { UnifiedCreditsRow } from "./types";

function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function productFromCostsRow(row: UnifiedCreditsRow): Product | null {
  const p = row.product?.trim().toLowerCase() ?? "";
  if (p.includes("codex")) return Product.CODEX;
  if (p.includes("chatgpt") || p.includes("chat")) return Product.CHATGPT;
  return null;
}

type DayProductAgg = { credits: number; events: number };
type UserDayAgg = { credits: number; events: number };

export async function ingestUnifiedCreditsRows(
  prisma: PrismaClient,
  args: {
    rows: UnifiedCreditsRow[];
    actorEmail: string;
    usdPerCredit?: number;
  },
): Promise<{ snapshotsWritten: number; vendorDaysUpserted: number; vendorUserDaysUpserted: number }> {
  const usdPerCredit = args.usdPerCredit ?? OPENAI_CREDIT_OVERAGE_USD;
  const byDay = new Map<string, UnifiedCreditsRow[]>();
  for (const row of args.rows) {
    const list = byDay.get(row.day) ?? [];
    list.push(row);
    byDay.set(row.day, list);
  }

  let snapshotsWritten = 0;
  let vendorDaysUpserted = 0;
  let vendorUserDaysUpserted = 0;
  const now = new Date();

  for (const [day, dayRows] of byDay) {
    const byProduct = new Map<Product, DayProductAgg>();
    const byUser = new Map<string, UserDayAgg>();

    for (const row of dayRows) {
      const product = productFromCostsRow(row);
      if (!product) continue;

      const prodAgg = byProduct.get(product) ?? { credits: 0, events: 0 };
      prodAgg.credits += row.credits_total;
      prodAgg.events += 1;
      byProduct.set(product, prodAgg);

      const email = row.email?.trim();
      if (email?.includes("@")) {
        const key = `${product}:${normEmail(email)}`;
        const userAgg = byUser.get(key) ?? { credits: 0, events: 0 };
        userAgg.credits += row.credits_total;
        userAgg.events += 1;
        byUser.set(key, userAgg);
      }
    }

    if (byProduct.size === 0) continue;

    await prisma.programVendorExportSnapshot.create({
      data: {
        kind: UNIFIED_CREDITS_SNAPSHOT_KIND,
        filename: `unified-credits-costs-${day}.jsonl`,
        periodStart: calendarDayAtNoonFromYmd(day),
        periodEnd: calendarDayAtNoonFromYmd(day),
        rowCount: dayRows.length,
        actorEmail: args.actorEmail,
        payload: {
          source: "unified_credits_compliance_api",
          periodStart: day,
          periodEnd: day,
          rows: dayRows.map((r) => ({ ...r, raw: r.raw })),
        } as object,
      },
    });
    snapshotsWritten += 1;

    const dayDate = calendarDayAtNoonFromYmd(day);
    for (const [product, agg] of byProduct) {
      const spendUsd = agg.credits * usdPerCredit;
      if (spendUsd <= 0) continue;
      await prisma.vendorDailySpend.upsert({
        where: {
          vendor_product_day: {
            vendor: UNIFIED_CREDITS_VENDOR_KEY,
            product,
            day: dayDate,
          },
        },
        create: {
          vendor: UNIFIED_CREDITS_VENDOR_KEY,
          product,
          day: dayDate,
          spendUsd,
          eventCount: agg.events,
          syncedAt: now,
        },
        update: {
          // Sync only passes newly seen event_ids — accumulate, don't overwrite.
          spendUsd: { increment: spendUsd },
          eventCount: { increment: agg.events },
          syncedAt: now,
        },
      });
      vendorDaysUpserted += 1;
    }

    for (const [key, agg] of byUser) {
      const [productStr, userEmail] = key.split(":");
      const product = productStr === Product.CODEX ? Product.CODEX : Product.CHATGPT;
      const spendUsd = agg.credits * usdPerCredit;
      if (spendUsd <= 0 || !userEmail?.includes("@")) continue;
      await prisma.vendorUserDailySpend.upsert({
        where: {
          vendor_product_day_userEmail: {
            vendor: UNIFIED_CREDITS_VENDOR_KEY,
            product,
            day: dayDate,
            userEmail,
          },
        },
        create: {
          vendor: UNIFIED_CREDITS_VENDOR_KEY,
          product,
          day: dayDate,
          userEmail,
          spendUsd,
          eventCount: agg.events,
          syncedAt: now,
        },
        update: {
          spendUsd: { increment: spendUsd },
          eventCount: { increment: agg.events },
          syncedAt: now,
        },
      });
      vendorUserDaysUpserted += 1;
    }
  }

  return { snapshotsWritten, vendorDaysUpserted, vendorUserDaysUpserted };
}
