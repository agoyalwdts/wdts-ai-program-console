/**
 * Built-in dashboard roles (LDR 0005).
 *
 * Source of truth for the FOUR built-ins:
 *   USER, MANAGER, FINOPS, ADMIN.
 *
 * Seeded into Postgres via `prisma/seed.ts` and re-synced on every
 * `db seed` run — i.e. if a deploy changes the permission list for
 * a built-in role, the next seed picks it up. Custom roles are
 * never touched by the seed; they live entirely in the DB.
 *
 * Why "ADMIN inherits everything programmatically" rather than
 * listing every permission: it makes the implication "an ADMIN
 * never loses access when a new permission is added in code" hold
 * automatically. Other built-ins are explicit lists so granting
 * them a new permission is a deliberate change.
 */

import { ALL_PERMISSION_KEYS, PERMISSIONS } from "./permissions";
import type { PermissionKey } from "./permissions";

export type BuiltInRoleKey = "USER" | "MANAGER" | "FINOPS" | "ADMIN";

export type BuiltInRoleDef = {
  key: BuiltInRoleKey;
  displayName: string;
  description: string;
  /** Permissions the role grants. ADMIN's array is computed at module
   *  load time so it always matches the full catalogue. */
  permissions: ReadonlyArray<PermissionKey>;
};

const USER_PERMS: ReadonlyArray<PermissionKey> = [
  // Default role — everyone signed in gets read access to the
  // self-service / public surfaces.
  PERMISSIONS.DASHBOARD_VIEW_HEALTH,
  PERMISSIONS.DASHBOARD_VIEW_USERS,
  PERMISSIONS.DASHBOARD_VIEW_CURSOR_SEATS,
  PERMISSIONS.DASHBOARD_VIEW_DECISIONS,
  PERMISSIONS.DASHBOARD_VIEW_ANALYTICS,
];

const MANAGER_PERMS: ReadonlyArray<PermissionKey> = [
  ...USER_PERMS,
  // Plus their own team's queue. The manager-scoping (own-reports
  // only) happens at the data layer, not at the permission layer.
  PERMISSIONS.DASHBOARD_VIEW_MANAGERS,
];

const FINOPS_PERMS: ReadonlyArray<PermissionKey> = [
  ...MANAGER_PERMS,
  // Cost surfaces.
  PERMISSIONS.DASHBOARD_VIEW_CHARGEBACK,
  PERMISSIONS.DASHBOARD_VIEW_CODEX_LADDER,
  PERMISSIONS.DASHBOARD_VIEW_SETTINGS,
  // Operations.
  PERMISSIONS.IMPORTS_EMPLOYEES,
  PERMISSIONS.IMPORTS_CURSOR_USAGE,
  PERMISSIONS.VENDOR_SPEND_SYNC,
  PERMISSIONS.DECISIONS_EXPORT,
];

// ADMIN gets every permission the catalogue declares. Programmatic
// rather than literal so a new permission added in `permissions.ts`
// automatically lands on ADMIN without touching this file.
const ADMIN_PERMS: ReadonlyArray<PermissionKey> = ALL_PERMISSION_KEYS;

export const BUILT_IN_ROLES: ReadonlyArray<BuiltInRoleDef> = [
  {
    key: "USER",
    displayName: "User",
    description:
      "Default for any signed-in WDTS employee. Read-only access to public dashboard surfaces.",
    permissions: USER_PERMS,
  },
  {
    key: "MANAGER",
    displayName: "Manager",
    description:
      "Anyone with direct reports. Adds the manager queue (own team only).",
    permissions: MANAGER_PERMS,
  },
  {
    key: "FINOPS",
    displayName: "FinOps",
    description:
      "Cost owners. Reads everything (chargeback, ladder, settings) and can run CSV imports. Cannot approve exceptions or edit policy.",
    permissions: FINOPS_PERMS,
  },
  {
    key: "ADMIN",
    displayName: "Administrator",
    description:
      "Full access. Manage users, manage roles, approve decisions, edit policy. Owner is implicitly ADMIN.",
    permissions: ADMIN_PERMS,
  },
];

export const BUILT_IN_ROLE_KEYS: ReadonlyArray<BuiltInRoleKey> =
  BUILT_IN_ROLES.map((r) => r.key);

export function getBuiltInRole(key: string): BuiltInRoleDef | undefined {
  return BUILT_IN_ROLES.find((r) => r.key === key);
}

export function isBuiltInRoleKey(key: string): key is BuiltInRoleKey {
  return BUILT_IN_ROLES.some((r) => r.key === key);
}
