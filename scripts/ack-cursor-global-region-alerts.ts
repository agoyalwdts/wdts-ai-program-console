#!/usr/bin/env npx tsx
/**
 * Acknowledge open false-positive guardrail alerts:
 *   ruleCode = REGION_OUTSIDE_STRICT_ALLOWLIST
 *   product  = CURSOR
 *   region   = global (matched via rationale text; context stores allowlist only)
 *
 * Cursor Team Admin filtered-usage-events do not carry cloud routing metadata;
 * the monitor now skips this rule for `CURSOR_ADMIN_API` + `global`. This script
 * clears historical rows created before that fix.
 *
 * **Safety**
 *   - Default is **dry-run** (counts + sample, no writes).
 *   - Pass `--apply` to set `acknowledgedAt` on matching rows.
 *
 * **Example (prod)**
 *
 *   export DATABASE_URL="$(az keyvault secret show --vault-name wdts-ai-cons-kv \
 *     --name DATABASE-URL --query value -o tsv)"
 *   npx tsx scripts/ack-cursor-global-region-alerts.ts
 *
 *   # then, if the dry-run output looks correct:
 *   ...same env... npx tsx scripts/ack-cursor-global-region-alerts.ts --apply
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Stable match for Cursor feed rows with region `global`. */
export const CURSOR_GLOBAL_REGION_ALERT_WHERE = {
  ruleCode: "REGION_OUTSIDE_STRICT_ALLOWLIST",
  product: "CURSOR" as const,
  acknowledgedAt: null,
  rationale: { contains: "region 'global'", mode: "insensitive" as const },
};

async function main() {
  const apply = process.argv.includes("--apply");

  if (!process.env.DATABASE_URL) {
    console.error("[ack-cursor-global-region] DATABASE_URL is required.");
    process.exit(1);
  }

  try {
    const host = new URL(process.env.DATABASE_URL).hostname;
    console.log(`[ack-cursor-global-region] database host=${host}`);
    if (host === "localhost" || host === "127.0.0.1") {
      console.warn(
        "[ack-cursor-global-region] Warning: local DATABASE_URL — use `export DATABASE_URL=...` for prod.",
      );
    }
  } catch {
    /* non-URL connection strings — skip host hint */
  }

  const total = await prisma.guardrailPolicyAlert.count({
    where: CURSOR_GLOBAL_REGION_ALERT_WHERE,
  });

  const sample = await prisma.guardrailPolicyAlert.findMany({
    where: CURSOR_GLOBAL_REGION_ALERT_WHERE,
    orderBy: { occurredAt: "desc" },
    take: 10,
    select: {
      id: true,
      occurredAt: true,
      userEmail: true,
      model: true,
      severity: true,
      source: true,
    },
  });

  console.log(
    `[ack-cursor-global-region] dryRun=${!apply} matchingOpenAlerts=${total}`,
  );
  for (const row of sample) {
    console.log(
      `  sample: ${row.occurredAt.toISOString()} ${row.userEmail ?? "(no email)"} ` +
        `${row.model ?? "—"} ${row.severity} source=${row.source ?? "—"} id=${row.id}`,
    );
  }
  if (total > sample.length) {
    console.log(`  … and ${total - sample.length} more`);
  }

  if (total === 0) {
    console.log("\n[ack-cursor-global-region] Nothing to do.");
    return;
  }

  if (!apply) {
    console.log("\n[ack-cursor-global-region] Dry run only. Re-run with --apply to write.");
    return;
  }

  const now = new Date();
  const updated = await prisma.guardrailPolicyAlert.updateMany({
    where: CURSOR_GLOBAL_REGION_ALERT_WHERE,
    data: { acknowledgedAt: now },
  });

  await prisma.decision.create({
    data: {
      type: "METHODOLOGY_CHANGE",
      beforeState: JSON.stringify({
        action: "ack-cursor-global-region-alerts",
        openMatching: total,
      }),
      afterState: JSON.stringify({
        acknowledgedCount: updated.count,
        acknowledgedAt: now.toISOString(),
        ruleCode: "REGION_OUTSIDE_STRICT_ALLOWLIST",
        product: "CURSOR",
        regionMatch: "global",
      }),
      actorEmail: "script:ack-cursor-global-region-alerts@dashboard",
      justification:
        `Bulk-acknowledged ${updated.count} false-positive CURSOR ` +
        `REGION_OUTSIDE_STRICT_ALLOWLIST alert(s) for region global ` +
        `(Cursor admin API has no cloud region metadata).`,
    },
  });

  console.log(
    `\n[ack-cursor-global-region] Applied: acknowledged=${updated.count}, decision logged.`,
  );
}

main()
  .catch((e) => {
    console.error("[ack-cursor-global-region] failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
