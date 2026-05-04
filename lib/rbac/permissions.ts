/**
 * Permission catalogue for the dashboard's app-level RBAC (LDR 0005).
 *
 * Permissions are *code-defined* — the keys below are the only values
 * the application enforces. Roles (built-in + custom) reference these
 * keys via `Role.permissions: string[]`. Adding a permission is a code
 * change; granting it to a role is a runtime change via /settings/roles.
 *
 * Naming convention:
 *   "<resource>.<verb>"
 *
 *   resource: dashboard surface or domain entity (users, roles, decisions,
 *             chargeback, imports, settings, …)
 *   verb:     view | edit | create | delete | manage | approve | export
 *             ("manage" = "edit + create + delete" for the same resource)
 *
 * If you add a permission here, also:
 *   1. update `lib/rbac/built-in-roles.ts` if any built-in role should
 *      get it by default,
 *   2. wire the actual enforcement (a `requirePermission(KEY)` call in
 *      the relevant page/route).
 */

export const PERMISSIONS = {
  // Read access to dashboard surfaces. Most signed-in users get all of
  // these — the gates exist so a reduced "auditor" custom role could
  // strip individual surfaces if that's ever useful.
  DASHBOARD_VIEW_HEALTH: "dashboard.view_health",
  DASHBOARD_VIEW_USERS: "dashboard.view_users",
  DASHBOARD_VIEW_CURSOR_SEATS: "dashboard.view_cursor_seats",
  DASHBOARD_VIEW_DECISIONS: "dashboard.view_decisions",
  DASHBOARD_VIEW_CHARGEBACK: "dashboard.view_chargeback",
  DASHBOARD_VIEW_CODEX_LADDER: "dashboard.view_codex_ladder",
  DASHBOARD_VIEW_MANAGERS: "dashboard.view_managers",
  DASHBOARD_VIEW_SETTINGS: "dashboard.view_settings",

  // Operations.
  IMPORTS_EMPLOYEES: "imports.employees",
  /// Ingest Cursor admin team-usage CSV; creates prudence alerts + optional email.
  IMPORTS_CURSOR_USAGE: "imports.cursor_usage",
  /// Pull Cursor Team Admin usage → VendorDailySpend (Program Health CURSOR tile).
  VENDOR_SPEND_SYNC: "vendor_spend.sync",
  DECISIONS_EXPORT: "decisions.export",

  // Admin surfaces.
  USERS_MANAGE: "users.manage",
  ROLES_MANAGE: "roles.manage",

  // Future write paths — declared in the catalogue now so a custom role
  // created today can opt into them as soon as the write surface lands,
  // without a code change at that point.
  DECISIONS_APPROVE: "decisions.approve",
  POLICY_EDIT: "policy.edit",
  EXCEPTIONS_APPROVE: "exceptions.approve",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSION_KEYS: ReadonlyArray<PermissionKey> = Object.values(
  PERMISSIONS,
);

/**
 * Human-friendly metadata. Keyed by permission value (the dotted string),
 * not by the constant name, so the /settings/roles UI can render the
 * catalogue in stable order with descriptions.
 */
export type PermissionMeta = {
  key: PermissionKey;
  category: "Dashboard" | "Operations" | "Admin" | "Future write paths";
  displayName: string;
  description: string;
};

export const PERMISSION_CATALOG: ReadonlyArray<PermissionMeta> = [
  {
    key: PERMISSIONS.DASHBOARD_VIEW_HEALTH,
    category: "Dashboard",
    displayName: "View health (F1)",
    description: "Program spend trend, budget bar, top spenders.",
  },
  {
    key: PERMISSIONS.DASHBOARD_VIEW_USERS,
    category: "Dashboard",
    displayName: "View users (F2)",
    description: "Per-user license + spend breakdown.",
  },
  {
    key: PERMISSIONS.DASHBOARD_VIEW_CURSOR_SEATS,
    category: "Dashboard",
    displayName: "View Cursor seat board (F4)",
    description: "120-seat board, sub-tiers, waitlist.",
  },
  {
    key: PERMISSIONS.DASHBOARD_VIEW_DECISIONS,
    category: "Dashboard",
    displayName: "View decision log (F5)",
    description: "Audit log of program decisions.",
  },
  {
    key: PERMISSIONS.DASHBOARD_VIEW_CHARGEBACK,
    category: "Dashboard",
    displayName: "View chargeback (F8)",
    description: "Per-cost-centre spend allocation.",
  },
  {
    key: PERMISSIONS.DASHBOARD_VIEW_CODEX_LADDER,
    category: "Dashboard",
    displayName: "View Codex ladder (F10)",
    description: "Codex sub-tier promotion/demotion ladder.",
  },
  {
    key: PERMISSIONS.DASHBOARD_VIEW_MANAGERS,
    category: "Dashboard",
    displayName: "View manager queue",
    description: "Direct-report cap utilisation. Managers see their team only.",
  },
  {
    key: PERMISSIONS.DASHBOARD_VIEW_SETTINGS,
    category: "Dashboard",
    displayName: "View settings",
    description:
      "/settings page itself — integration probes, mode flags, program constants.",
  },
  {
    key: PERMISSIONS.IMPORTS_EMPLOYEES,
    category: "Operations",
    displayName: "Import employees (CSV)",
    description: "Upsert the User table from a CSV upload.",
  },
  {
    key: PERMISSIONS.IMPORTS_CURSOR_USAGE,
    category: "Operations",
    displayName: "Cursor usage prudence (CSV)",
    description:
      "Upload Cursor team-usage export; flag expensive models / Max mode vs token workload.",
  },
  {
    key: PERMISSIONS.VENDOR_SPEND_SYNC,
    category: "Operations",
    displayName: "Sync vendor spend (Cursor API)",
    description:
      "Trigger Cursor Team Admin API pull into VendorDailySpend for accurate F1 CURSOR totals.",
  },
  {
    key: PERMISSIONS.DECISIONS_EXPORT,
    category: "Operations",
    displayName: "Export decision log",
    description: "Download the decision log as CSV.",
  },
  {
    key: PERMISSIONS.USERS_MANAGE,
    category: "Admin",
    displayName: "Manage users",
    description:
      "Change a user's dashboard role, enable/disable users, transfer ownership.",
  },
  {
    key: PERMISSIONS.ROLES_MANAGE,
    category: "Admin",
    displayName: "Manage roles",
    description:
      "Create custom roles, edit role permissions (built-in roles' permissions are read-only).",
  },
  {
    key: PERMISSIONS.DECISIONS_APPROVE,
    category: "Future write paths",
    displayName: "Approve decisions",
    description:
      "Reserved for future v0.4+ write paths: tier promotions, demotions, cap adjustments.",
  },
  {
    key: PERMISSIONS.POLICY_EDIT,
    category: "Future write paths",
    displayName: "Edit policy",
    description:
      "Reserved for v0.4+ policy-repo PR creation from the dashboard.",
  },
  {
    key: PERMISSIONS.EXCEPTIONS_APPROVE,
    category: "Future write paths",
    displayName: "Approve exception requests",
    description:
      "Reserved for v0.4+ exception-request review surface (F11).",
  },
];

/**
 * `true` if `key` is a member of {@link ALL_PERMISSION_KEYS}. Used at
 * the API boundary when an admin posts a custom role's permission list,
 * to reject typos or stale keys.
 */
export function isValidPermissionKey(key: string): key is PermissionKey {
  return (ALL_PERMISSION_KEYS as ReadonlyArray<string>).includes(key);
}
