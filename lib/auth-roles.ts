/**
 * Pure role-mapping logic, separated from Auth.js wiring so Vitest can
 * unit-test it without spinning up next-auth.
 *
 * v0.3 model (LDR 0005 — app-level RBAC):
 *
 *   1. Postgres `User.dashboardRole` is the source of truth. Identity
 *      comes from the IdP (Microsoft Entra); authorization is owned
 *      by the dashboard.
 *   2. Bootstrap email rule — exactly one rule, granting ADMIN to the
 *      dashboard owner, exists so a fresh-DB / new-tenant deploy can
 *      sign in and configure other users without a chicken-and-egg.
 *      Once an ADMIN exists in the DB and is the signed-in user, this
 *      rule never fires. Drop after first sign-in if you want.
 *   3. Default — every other signed-in user gets the USER built-in.
 *
 * We deliberately do NOT resolve from the IdP's groups claim. AAD-group
 * RBAC was considered and rejected as inappropriate friction for an
 * internal taskforce tool (LDR 0005 §"Alternatives considered").
 */

import type { BuiltInRoleKey } from "./rbac/built-in-roles";

/**
 * Back-compat string union for the four built-in role keys, used by
 * `requireRole(["ADMIN", "FINOPS"])` and similar gates that pre-date
 * the permission catalogue. Custom roles do not appear here — they
 * grant access via permissions only.
 */
export type DashboardRole = BuiltInRoleKey;

export const DASHBOARD_ROLES: ReadonlyArray<DashboardRole> = [
  "ADMIN",
  "FINOPS",
  "MANAGER",
  "USER",
];

/**
 * Bootstrap rule. The owner's email pattern grants ADMIN at first
 * sign-in *only when the DB has no User row yet for that email* — the
 * JIT provisioner uses this to assign the right role on the very first
 * upsert. After that, every subsequent sign-in goes through the DB
 * path and this list is effectively dead code (it stays here because
 * losing it would brick a fresh-DB recovery).
 *
 * Add no other emails here. Other admins are promoted via /settings/users
 * once the owner has signed in.
 */
export const BOOTSTRAP_ADMIN_RULES: ReadonlyArray<{
  pattern: RegExp;
}> = [
  // Anuj — dashboard owner / CTO / head of AI Task Force.
  { pattern: /^agoyal@wdtablesystems\.com$/i },
];

export type RoleSource =
  | { kind: "db"; roleKey: string }
  | { kind: "email-bootstrap"; pattern: string }
  | { kind: "default" };

export type RoleResolution = {
  role: DashboardRole;
  source: RoleSource;
};

/**
 * Resolve a role for a sign-in *without touching the DB*. Used at
 * JIT-provision time, BEFORE the user's row exists, to decide what
 * default role to seed them with. Only returns ADMIN if the email
 * matches a bootstrap rule; otherwise returns USER.
 */
export function bootstrapRoleForNewUser(email: string): RoleResolution {
  for (const rule of BOOTSTRAP_ADMIN_RULES) {
    if (rule.pattern.test(email)) {
      return {
        role: "ADMIN",
        source: { kind: "email-bootstrap", pattern: rule.pattern.source },
      };
    }
  }
  return { role: "USER", source: { kind: "default" } };
}

/**
 * Wrap a DB-resolved role into a {@link RoleResolution}. Centralised
 * here so the trace shape stays consistent across every call site.
 */
export function dbRole(roleKey: string): RoleResolution {
  // The four built-ins are still the only values exposed to the
  // back-compat `DashboardRole` union; custom roles fall back to USER
  // for `requireRole(...)` checks but keep their permissions on the
  // session.
  const role: DashboardRole = isBuiltInRoleKey(roleKey)
    ? (roleKey as DashboardRole)
    : "USER";
  return { role, source: { kind: "db", roleKey } };
}

function isBuiltInRoleKey(k: string): k is BuiltInRoleKey {
  return k === "ADMIN" || k === "FINOPS" || k === "MANAGER" || k === "USER";
}
