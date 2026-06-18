#!/usr/bin/env npx tsx
/**
 * Acknowledge open false-positive guardrail alerts:
 *   ruleCode = UNAPPROVED_MODEL_ENDPOINT
 *   product  = CURSOR
 *   model    = default
 *
 * Cursor Team Admin API reports Auto/system picker as the literal model name
 * `default`. The allowlist now includes `default|auto|composer`; this script
 * clears historical rows from before that fix.
 *
 * **Safety**
 *   - Default is **dry-run** (counts + sample, no writes).
 *   - Pass `--apply` to set `acknowledgedAt` on matching rows.
 *
 * **Example (prod)**
 *
 *   export DATABASE_URL="$(az keyvault secret show --vault-name wdts-ai-cons-kv \
 *     --name DATABASE-URL --query value -o tsv)"
 *   npx tsx scripts/ack-cursor-default-model-alerts.ts
 *
 *   # then, if the dry-run output looks correct:
 *   ...same env... npx tsx scripts/ack-cursor-default-model-alerts.ts --apply
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Stable match for Cursor `default` model false positives. */
export const CURSOR_DEFAULT_MODEL_ALERT_WHERE = {
  ruleCode: "UNAPPROVED_MODEL_ENDPOINT",
  product: "CURSOR" as const,
  model: { equals: "default", mode: "insensitive" as const },
  acknowledgedAt: null,
};

async function main() {
  const apply = process.argv.includes("--apply");

  if (!process.env.DATABASE_URL) {
    console.error("[ack-cursor-default-model] DATABASE_URL is required.");
    process.exit(1);
  }

  try {
    const host = new URL(process.env.DATABASE_URL).hostname;
    console.log(`[ack-cursor-default-model] database host=${host}`);
    if (host === "localhost" || host === "127.0.0.1") {
      console.warn(
        "[ack-cursor-default-model] Warning: local DATABASE_URL — use `export DATABASE_URL=...` for prod.",
      );
    }
  } catch {
    /* non-URL connection strings — skip host hint */
  }

  const total = await prisma.guardrailPolicyAlert.count({
    where: CURSOR_DEFAULT_MODEL_ALERT_WHERE,
  });

  const sample = await prisma.guardrailPolicyAlert.findMany({
    where: CURSOR_DEFAULT_MODEL_ALERT_WHERE,
    orderBy: { occurredAt: "desc" },
    take: 10,
    select: {
      id: true,
      occurredAt: true,
      userEmail: true,
      model: true,
      severity: true,
      source: true,
      recommendation: true,
    },
  });

  console.log(
    `[ack-cursor-default-model] dryRun=${!apply} matchingOpenAlerts=${total}`,
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
    console.log("\n[ack-cursor-default-model] Nothing to do.");
    return;
  }

  if (!apply) {
    console.log("\n[ack-cursor-default-model] Dry run only. Re-run with --apply to write.");
    return;
  }

  const now = new Date();
  const updated = await prisma.guardrailPolicyAlert.updateMany({
    where: CURSOR_DEFAULT_MODEL_ALERT_WHERE,
    data: { acknowledgedAt: now },
  });

  await prisma.decision.create({
    data: {
      type: "METHODOLOGY_CHANGE",
      beforeState: JSON.stringify({
        action: "ack-cursor-default-model-alerts",
        openMatching: total,
      }),
      afterState: JSON.stringify({
        acknowledgedCount: updated.count,
        acknowledgedAt: now.toISOString(),
        ruleCode: "UNAPPROVED_MODEL_ENDPOINT",
        product: "CURSOR",
        model: "default",
      }),
      actorEmail: "script:ack-cursor-default-model-alerts@dashboard",
      justification:
        `Bulk-acknowledged ${updated.count} false-positive CURSOR ` +
        `UNAPPROVED_MODEL_ENDPOINT alert(s) for model default ` +
        `(Cursor Auto picker is on the allowlist).`,
    },
  });

  console.log(
    `\n[ack-cursor-default-model] Applied: acknowledged=${updated.count}, decision logged.`,
  );
}

main()
  .catch((e) => {
    console.error("[ack-cursor-default-model] failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
