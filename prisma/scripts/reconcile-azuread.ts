#!/usr/bin/env tsx
/**
 * Identity reconciler — mirrors Microsoft Graph users into the Prisma
 * User table. Run nightly (or on-demand from the dashboard's
 * /settings page in v0.4).
 *
 * Strategy:
 *   1. Pull every Graph user via realAzureADClient.listUsers().
 *   2. For each Graph user with a non-empty email, upsert into
 *      prisma.user matching on email.
 *      - On create: roleTag, managerId initialised from a sensible
 *        default (managerId resolved in a second pass; roleTag
 *        defaults to 'imported' until Deel reconciliation runs).
 *      - On update: only touch fields the reconciler owns
 *        (displayName, status). Don't clobber locally-edited fields.
 *   3. Soft-delete (status -> SUSPENDED) any Prisma user whose email
 *      no longer appears in Graph. Doesn't hard-delete because the
 *      Decision / UsageRecord history is FK'd to User and we want
 *      that history preserved for audit purposes.
 *   4. Wrap the whole pass in a Decision row of type
 *      METHODOLOGY_CHANGE summarising counts, so the audit trail
 *      shows what each reconciliation pass did.
 *
 * Two operational modes:
 *   --dry-run   prints the diff but doesn't write to Prisma.
 *               Use this to verify a fresh run before flipping over.
 *   (default)   applies the diff inside one transaction, including
 *               the Decision audit row.
 *
 * Env required:
 *   AZURE_AD_TENANT_ID / _CLIENT_ID / _CLIENT_SECRET (already used by
 *   the realAzureADClient).
 *   DATABASE_URL (always required).
 *
 * Refs: scoping §4 integration #2 (Azure AD), §9.1 (every write
 * through a Decision row).
 */

import { realAzureADClient } from "@/lib/integrations/azuread/real";
import { prisma } from "@/lib/prisma";
import type { IdentityUser } from "@/lib/integrations/azuread/types";

type ReconcilerArgs = {
  dryRun: boolean;
};

type ReconcilerSummary = {
  graphUserCount: number;
  graphSkippedNoEmail: number;
  prismaCreated: number;
  prismaUpdated: number;
  prismaSuspended: number;
  prismaSkippedClean: number;
};

export async function reconcileAzureAD(
  args: ReconcilerArgs,
): Promise<ReconcilerSummary> {
  const summary: ReconcilerSummary = {
    graphUserCount: 0,
    graphSkippedNoEmail: 0,
    prismaCreated: 0,
    prismaUpdated: 0,
    prismaSuspended: 0,
    prismaSkippedClean: 0,
  };

  const graphUsers = await realAzureADClient.listUsers();
  summary.graphUserCount = graphUsers.length;

  const byEmail = new Map<string, IdentityUser>();
  for (const u of graphUsers) {
    if (!u.email) {
      summary.graphSkippedNoEmail++;
      continue;
    }
    byEmail.set(u.email.toLowerCase(), u);
  }

  // Snapshot of every existing Prisma user so we can compute the
  // suspend set in O(1).
  const prismaUsers = await prisma.user.findMany({
    select: { id: true, email: true, displayName: true, status: true },
  });
  const prismaByEmail = new Map(prismaUsers.map((u) => [u.email.toLowerCase(), u]));

  const ops: Array<{ op: "create" | "update" | "suspend"; email: string; detail: string }> = [];

  // (a) creates + updates from the Graph side.
  for (const [email, gu] of byEmail) {
    const existing = prismaByEmail.get(email);
    if (!existing) {
      ops.push({
        op: "create",
        email,
        detail: `displayName=${gu.displayName} status=${gu.status}`,
      });
      continue;
    }
    const wantStatus = gu.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";
    if (existing.displayName !== gu.displayName || existing.status !== wantStatus) {
      ops.push({
        op: "update",
        email,
        detail: `displayName: ${existing.displayName} -> ${gu.displayName}; ` +
          `status: ${existing.status} -> ${wantStatus}`,
      });
    } else {
      summary.prismaSkippedClean++;
    }
  }

  // (b) suspend Prisma users not in Graph.
  for (const [email, u] of prismaByEmail) {
    if (byEmail.has(email)) continue;
    if (u.status === "SUSPENDED") continue;
    ops.push({ op: "suspend", email, detail: `status: ${u.status} -> SUSPENDED` });
  }

  if (args.dryRun) {
    console.log(`[reconciler] DRY RUN — would apply ${ops.length} ops:`);
    for (const o of ops) console.log(`  ${o.op.padEnd(8)} ${o.email} | ${o.detail}`);
    summary.prismaCreated = ops.filter((o) => o.op === "create").length;
    summary.prismaUpdated = ops.filter((o) => o.op === "update").length;
    summary.prismaSuspended = ops.filter((o) => o.op === "suspend").length;
    return summary;
  }

  // Apply inside one transaction so a partial failure leaves Prisma
  // unchanged. The Decision row goes in the same transaction so the
  // audit ledger and the data ledger never disagree.
  await prisma.$transaction(async (tx) => {
    for (const o of ops) {
      if (o.op === "create") {
        const gu = byEmail.get(o.email)!;
        await tx.user.create({
          data: {
            email: o.email,
            displayName: gu.displayName,
            roleTag: "imported",
            region: "unknown",
            status: gu.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
          },
        });
        summary.prismaCreated++;
      } else if (o.op === "update") {
        const gu = byEmail.get(o.email)!;
        await tx.user.update({
          where: { email: o.email },
          data: {
            displayName: gu.displayName,
            status: gu.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
          },
        });
        summary.prismaUpdated++;
      } else {
        await tx.user.update({
          where: { email: o.email },
          data: { status: "SUSPENDED" },
        });
        summary.prismaSuspended++;
      }
    }
    await tx.decision.create({
      data: {
        type: "METHODOLOGY_CHANGE",
        beforeState: JSON.stringify({}),
        afterState: JSON.stringify(summary),
        actorEmail: "azuread-reconciler@dashboard",
        justification: `AzureAD reconciliation: ` +
          `${summary.prismaCreated} created, ` +
          `${summary.prismaUpdated} updated, ` +
          `${summary.prismaSuspended} suspended, ` +
          `${summary.prismaSkippedClean} clean.`,
      },
    });
  });

  return summary;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`[reconciler] starting (dryRun=${dryRun})…`);
  const summary = await reconcileAzureAD({ dryRun });
  console.log("[reconciler] done.", summary);
}

// Only run main() when invoked as a script. Importing this module from
// a test or a future API route doesn't trigger the side effect.
// `require.main === module` is Node-only and works under tsx.
declare const require: { main: unknown } | undefined;
if (typeof require !== "undefined" && require.main === module) {
  main()
    .catch((err) => {
      console.error("[reconciler] failed:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
