#!/usr/bin/env npx tsx
/**
 * Disable every `User` who is **not** the dashboard owner and whose
 * email (case-insensitive) is **not** in `ALLOWLIST_EMAILS`.
 *
 * Use after a mistaken AzureAD reconciler apply that created sign-in-
 * eligible rows for a full Entra tenant. New reconciler behaviour
 * (PR #24) creates mirror rows with `disabled=true` instead; this script
 * is for **cleaning existing prod data** once.
 *
 * **Safety**
 *   - Default is **dry-run** (prints who would be disabled, no writes).
 *   - Pass `--apply` to execute.
 *   - Rows with `isOwner=true` are **never** touched.
 *   - `ALLOWLIST_EMAILS` is required (comma-separated). Refuses if empty
 *     unless you also pass `--i-understand-empty-allowlist` (disables
 *     everyone except the owner — almost certainly not what you want).
 *
 * **Audit**
 *   - On `--apply`, writes one `Decision` row (`METHODOLOGY_CHANGE`)
 *     summarising how many users were disabled and listing their emails
 *     (capped at 500 in JSON for row size).
 *
 * **Example (prod — pull DATABASE_URL from Key Vault first)**
 *
 *   ALLOWLIST_EMAILS="agoyal@wdtablesystems.com,colleague@wdtablesystems.com" \
 *   DATABASE_URL="$(az keyvault secret show --vault-name wdts-ai-cons-kv \
 *     --name DATABASE-URL --query value -o tsv)" \
 *   npx tsx scripts/disable-users-not-on-allowlist.ts
 *
 *   # then, if the dry-run output looks correct:
 *   ...same env... npx tsx scripts/disable-users-not-on-allowlist.ts --apply
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseAllowlist(raw: string | undefined): Set<string> {
  if (!raw?.trim()) return new Set();
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function main() {
  const apply = process.argv.includes("--apply");
  const allowRaw = process.env.ALLOWLIST_EMAILS;
  const allow = parseAllowlist(allowRaw);

  if (allow.size === 0 && !process.argv.includes("--i-understand-empty-allowlist")) {
    console.error(
      "[disable-users] Set ALLOWLIST_EMAILS (comma-separated work emails that " +
        "should **remain able to sign in**). Owner rows are never disabled. " +
        "Refusing with empty allowlist. If you truly intend an empty allowlist " +
        "(disable everyone except owner), pass --i-understand-empty-allowlist.",
    );
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("[disable-users] DATABASE_URL is required.");
    process.exit(1);
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      disabled: true,
      isOwner: true,
    },
  });

  const toDisable = users.filter((u) => {
    if (u.isOwner) return false;
    if (u.disabled) return false;
    const lc = u.email.toLowerCase();
    return !allow.has(lc);
  });

  console.log(
    `[disable-users] dryRun=${!apply} allowlistSize=${allow.size} ` +
      `candidates=${toDisable.length} (non-owner, currently enabled, not on allowlist)`,
  );
  for (const u of toDisable.slice(0, 50)) {
    console.log(`  would disable: ${u.email}`);
  }
  if (toDisable.length > 50) {
    console.log(`  … and ${toDisable.length - 50} more`);
  }

  if (!apply) {
    console.log("\n[disable-users] Dry run only. Re-run with --apply to write.");
    return;
  }

  const emails = toDisable.map((u) => u.email);
  await prisma.$transaction(async (tx) => {
    for (const u of toDisable) {
      await tx.user.update({
        where: { id: u.id },
        data: { disabled: true },
      });
    }
    await tx.decision.create({
      data: {
        type: "METHODOLOGY_CHANGE",
        beforeState: JSON.stringify({ action: "disable-users-not-on-allowlist", count: 0 }),
        afterState: JSON.stringify({
          disabledCount: toDisable.length,
          emails: emails.slice(0, 500),
        }),
        actorEmail: "script:disable-users-not-on-allowlist@dashboard",
        justification:
          `Bulk-disabled ${toDisable.length} user(s) not on ALLOWLIST_EMAILS ` +
          `(closed-by-default cleanup after reconciler widen).`,
      },
    });
  });

  console.log(`\n[disable-users] Applied: disabled ${toDisable.length} user(s).`);
}

main()
  .catch((e) => {
    console.error("[disable-users] failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
