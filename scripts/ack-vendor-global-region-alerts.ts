#!/usr/bin/env npx tsx
/**
 * Acknowledge open false-positive guardrail alerts:
 *   ruleCode = REGION_OUTSIDE_STRICT_ALLOWLIST
 *   product  = CURSOR | CODEX
 *   region   = global (via rationale text)
 *
 * Cursor Admin API and Codex Enterprise Analytics do not carry cloud routing
 * metadata; the monitor skips this rule for vendor feeds + `global`. Clears
 * historical rows from before that fix.
 */

import type { Prisma } from "@prisma/client";
import { PrismaClient, Product } from "@prisma/client";

const prisma = new PrismaClient();

export const VENDOR_GLOBAL_REGION_PRODUCTS: Product[] = ["CURSOR", "CODEX"];

export function vendorGlobalRegionAlertWhere(
  products: Product[] = VENDOR_GLOBAL_REGION_PRODUCTS,
): Prisma.GuardrailPolicyAlertWhereInput {
  return {
    ruleCode: "REGION_OUTSIDE_STRICT_ALLOWLIST",
    product: products.length === 1 ? products[0] : { in: products },
    acknowledgedAt: null,
    rationale: { contains: "region 'global'", mode: "insensitive" },
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const productArg = process.argv.find((a) => a.startsWith("--product="));
  const products: Product[] = productArg
    ? ([productArg.split("=")[1]?.toUpperCase()] as Product[])
    : VENDOR_GLOBAL_REGION_PRODUCTS;

  if (!process.env.DATABASE_URL) {
    console.error("[ack-vendor-global-region] DATABASE_URL is required.");
    process.exit(1);
  }

  try {
    const host = new URL(process.env.DATABASE_URL).hostname;
    console.log(`[ack-vendor-global-region] database host=${host} products=${products.join(",")}`);
  } catch {
    /* skip */
  }

  const where = vendorGlobalRegionAlertWhere(products);
  const total = await prisma.guardrailPolicyAlert.count({ where });

  const sample = await prisma.guardrailPolicyAlert.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take: 10,
    select: {
      id: true,
      occurredAt: true,
      product: true,
      userEmail: true,
      model: true,
      severity: true,
      source: true,
    },
  });

  console.log(`[ack-vendor-global-region] dryRun=${!apply} matchingOpenAlerts=${total}`);
  for (const row of sample) {
    console.log(
      `  sample: ${row.occurredAt.toISOString()} ${row.product} ${row.userEmail ?? "(no email)"} ` +
        `${row.model ?? "—"} source=${row.source ?? "—"} id=${row.id}`,
    );
  }
  if (total > sample.length) {
    console.log(`  … and ${total - sample.length} more`);
  }

  if (total === 0) {
    console.log("\n[ack-vendor-global-region] Nothing to do.");
    return;
  }

  if (!apply) {
    console.log("\n[ack-vendor-global-region] Dry run only. Re-run with --apply to write.");
    return;
  }

  const now = new Date();
  const updated = await prisma.guardrailPolicyAlert.updateMany({
    where,
    data: { acknowledgedAt: now },
  });

  await prisma.decision.create({
    data: {
      type: "METHODOLOGY_CHANGE",
      beforeState: JSON.stringify({
        action: "ack-vendor-global-region-alerts",
        products,
        openMatching: total,
      }),
      afterState: JSON.stringify({
        acknowledgedCount: updated.count,
        acknowledgedAt: now.toISOString(),
        ruleCode: "REGION_OUTSIDE_STRICT_ALLOWLIST",
        regionMatch: "global",
      }),
      actorEmail: "script:ack-vendor-global-region-alerts@dashboard",
      justification:
        `Bulk-acknowledged ${updated.count} false-positive ` +
        `${products.join("/")} REGION_OUTSIDE_STRICT_ALLOWLIST alert(s) for region global ` +
        `(vendor analytics feeds have no cloud region metadata).`,
    },
  });

  console.log(
    `\n[ack-vendor-global-region] Applied: acknowledged=${updated.count}, decision logged.`,
  );
}

main()
  .catch((e) => {
    console.error("[ack-vendor-global-region] failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
