/**
 * Non-destructive RBAC initialization for an environment that already
 * has data (i.e. production after a migration but before a re-seed).
 *
 * Run on the server / CI side after `prisma migrate deploy` lands the
 * RBAC tables. Does NOT touch User/License/UsageRecord/Decision rows
 * apart from:
 *   1. Upserting the four built-in Role rows from
 *      lib/rbac/built-in-roles.ts (re-syncs the permission lists if
 *      a deploy changed the catalogue).
 *   2. Ensuring the dashboard owner has isOwner=true, the right
 *      title, and is linked to the ADMIN role.
 *   3. Backfilling User.dashboardRoleId=USER for any pre-existing
 *      rows the migration left as NULL (so existing users continue
 *      to work without re-signing-in).
 *
 * Idempotent — safe to re-run.
 *
 *   DATABASE_URL=… npx tsx scripts/rbac-deploy.ts
 */

import { PrismaClient } from "@prisma/client";
import { BUILT_IN_ROLES } from "../lib/rbac/built-in-roles";

const prisma = new PrismaClient();

const OWNER_EMAIL = "agoyal@wdtablesystems.com";
const OWNER_DISPLAY_NAME = "Anuj Goyal";
const OWNER_TITLE = "Chief Technology Officer · Head of AI Task Force";

async function main() {
  const target = new URL(
    process.env.DATABASE_URL ?? "postgresql://localhost/postgres",
  );
  console.log(`[rbac-deploy] target host: ${target.host}`);
  console.log(`[rbac-deploy] target db:   ${target.pathname.replace(/^\//, "")}`);
  console.log("");

  // 1) Built-in roles.
  console.log(`[rbac-deploy] upserting ${BUILT_IN_ROLES.length} built-in roles…`);
  const roleIdByKey = new Map<string, string>();
  for (const def of BUILT_IN_ROLES) {
    const r = await prisma.role.upsert({
      where: { key: def.key },
      update: {
        displayName: def.displayName,
        description: def.description,
        permissions: [...def.permissions],
        isBuiltIn: true,
      },
      create: {
        key: def.key,
        displayName: def.displayName,
        description: def.description,
        permissions: [...def.permissions],
        isBuiltIn: true,
      },
    });
    roleIdByKey.set(def.key, r.id);
    console.log(
      `  ✓ ${def.key.padEnd(8)}  ${r.permissions.length.toString().padStart(2)} permissions`,
    );
  }
  const adminRoleId = roleIdByKey.get("ADMIN")!;
  const userRoleId = roleIdByKey.get("USER")!;

  // 2) Owner row.
  console.log("");
  console.log(`[rbac-deploy] ensuring owner row for ${OWNER_EMAIL}…`);
  const owner = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: {
      displayName: OWNER_DISPLAY_NAME,
      title: OWNER_TITLE,
      isOwner: true,
      disabled: false,
      dashboardRoleId: adminRoleId,
    },
    create: {
      email: OWNER_EMAIL,
      displayName: OWNER_DISPLAY_NAME,
      title: OWNER_TITLE,
      isOwner: true,
      disabled: false,
      roleTag: "EXEC",
      region: "APAC-AU",
      status: "ACTIVE",
      dashboardRoleId: adminRoleId,
    },
  });
  console.log(`  ✓ ${owner.email}  isOwner=${owner.isOwner}  role=ADMIN`);

  // 3) Backfill any existing users that lack a dashboardRoleId.
  //    Pre-existing seed rows won't have the FK set after migrate
  //    deploy because the column was just added; assign them the
  //    USER built-in so requireRole/requirePermission resolve cleanly.
  console.log("");
  console.log("[rbac-deploy] backfilling dashboardRoleId for existing rows…");
  const updated = await prisma.user.updateMany({
    where: {
      dashboardRoleId: null,
      email: { not: OWNER_EMAIL },
    },
    data: { dashboardRoleId: userRoleId },
  });
  console.log(`  ✓ ${updated.count} user(s) updated to USER`);

  // 4) Sanity report.
  console.log("");
  console.log("[rbac-deploy] post-state:");
  const roleCounts = await prisma.role.findMany({
    select: {
      key: true,
      isBuiltIn: true,
      _count: { select: { users: true } },
    },
    orderBy: [{ isBuiltIn: "desc" }, { key: "asc" }],
  });
  for (const r of roleCounts) {
    console.log(
      `  ${r.key.padEnd(10)} ${r.isBuiltIn ? "[built-in]" : "[custom]  "} ${r._count.users.toString().padStart(4)} user(s)`,
    );
  }
  const orphans = await prisma.user.count({
    where: { dashboardRoleId: null },
  });
  if (orphans > 0) {
    console.warn(
      `  ⚠ ${orphans} user(s) still have dashboardRoleId=null. ` +
        "These will resolve to USER at sign-in, but should be backfilled.",
    );
  }
  const owners = await prisma.user.count({ where: { isOwner: true } });
  console.log(`  isOwner=true rows: ${owners} (expected: 1)`);

  console.log("");
  console.log("[rbac-deploy] done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
