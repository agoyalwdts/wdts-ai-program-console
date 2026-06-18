#!/usr/bin/env npx tsx
/**
 * Acknowledge open false-positive CURSOR UNAPPROVED_MODEL_ENDPOINT alerts whose
 * `model` now passes `MODEL_ALLOWLIST.CURSOR` (e.g. `default`, `composer-2.5`,
 * `composer-2.5-fast`). Historical rows from before the allowlist was widened.
 *
 * Does **not** ack models that still fail the allowlist (e.g. `agent_review`, `grok-4.3`).
 *
 * **Safety**
 *   - Default is **dry-run** (counts + sample, no writes).
 *   - Pass `--apply` to set `acknowledgedAt` on matching rows.
 *
 * **Example (prod)**
 *
 *   export DATABASE_URL="$(az keyvault secret show --vault-name wdts-ai-cons-kv \
 *     --name DATABASE-URL --query value -o tsv)"
 *   npm run db:ack-cursor-allowlist-false-positives
 *   npm run db:ack-cursor-allowlist-false-positives -- --apply
 */

import { PrismaClient } from "@prisma/client";
import { MODEL_ALLOWLIST } from "@/lib/guardrails/day-one-defaults";

const prisma = new PrismaClient();
const BATCH_SIZE = 250;

export function cursorModelPassesAllowlist(model: string | null | undefined): boolean {
  if (!model?.trim()) return false;
  return MODEL_ALLOWLIST.CURSOR.test(model.trim());
}

export async function listCursorAllowlistFalsePositiveIds(
  client: Pick<PrismaClient, "guardrailPolicyAlert">,
): Promise<string[]> {
  const rows = await client.guardrailPolicyAlert.findMany({
    where: {
      ruleCode: "UNAPPROVED_MODEL_ENDPOINT",
      product: "CURSOR",
      acknowledgedAt: null,
    },
    select: { id: true, model: true },
  });
  return rows.filter((r) => cursorModelPassesAllowlist(r.model)).map((r) => r.id);
}

async function main() {
  const apply = process.argv.includes("--apply");

  if (!process.env.DATABASE_URL) {
    console.error("[ack-cursor-allowlist-fp] DATABASE_URL is required.");
    process.exit(1);
  }

  try {
    const host = new URL(process.env.DATABASE_URL).hostname;
    console.log(`[ack-cursor-allowlist-fp] database host=${host}`);
    if (host === "localhost" || host === "127.0.0.1") {
      console.warn(
        "[ack-cursor-allowlist-fp] Warning: local DATABASE_URL — use `export DATABASE_URL=...` for prod.",
      );
    }
  } catch {
    /* non-URL connection strings — skip host hint */
  }

  const ids = await listCursorAllowlistFalsePositiveIds(prisma);
  const sample = await prisma.guardrailPolicyAlert.findMany({
    where: { id: { in: ids.slice(0, 10) } },
    orderBy: { occurredAt: "desc" },
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
    `[ack-cursor-allowlist-fp] dryRun=${!apply} matchingOpenAlerts=${ids.length}`,
  );
  for (const row of sample) {
    console.log(
      `  sample: ${row.occurredAt.toISOString()} ${row.userEmail ?? "(no email)"} ` +
        `${row.model ?? "—"} ${row.severity} id=${row.id}`,
    );
  }
  if (ids.length > sample.length) {
    console.log(`  … and ${ids.length - sample.length} more`);
  }

  if (ids.length === 0) {
    console.log("\n[ack-cursor-allowlist-fp] Nothing to do.");
    return;
  }

  if (!apply) {
    console.log("\n[ack-cursor-allowlist-fp] Dry run only. Re-run with --apply to write.");
    return;
  }

  const now = new Date();
  let updated = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const r = await prisma.guardrailPolicyAlert.updateMany({
      where: { id: { in: chunk } },
      data: { acknowledgedAt: now },
    });
    updated += r.count;
    console.log(
      `[ack-cursor-allowlist-fp] batch ${Math.floor(i / BATCH_SIZE) + 1}: updateMany count=${r.count}`,
    );
  }

  await prisma.decision.create({
    data: {
      type: "METHODOLOGY_CHANGE",
      beforeState: JSON.stringify({
        action: "ack-cursor-allowlist-false-positives",
        openMatching: ids.length,
      }),
      afterState: JSON.stringify({
        acknowledgedCount: updated,
        acknowledgedAt: now.toISOString(),
        ruleCode: "UNAPPROVED_MODEL_ENDPOINT",
        product: "CURSOR",
      }),
      actorEmail: "script:ack-cursor-allowlist-false-positives@dashboard",
      justification:
        `Bulk-acknowledged ${updated} false-positive CURSOR ` +
        `UNAPPROVED_MODEL_ENDPOINT alert(s) whose models now pass the allowlist.`,
    },
  });

  console.log(
    `\n[ack-cursor-allowlist-fp] Applied: acknowledged=${updated}, decision logged.`,
  );
}

main()
  .catch((e) => {
    console.error("[ack-cursor-allowlist-fp] failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
