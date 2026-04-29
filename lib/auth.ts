/**
 * Dashboard-facing auth helpers. The Auth.js v5 wiring lives at the
 * project root (auth.ts) per the Auth.js convention; this file is the
 * stable import surface for application code (Server Components, Route
 * Handlers, Server Actions).
 *
 * Discipline (per scoping §4 integration #1 + Next 16 proxy doc):
 *   - Use requireUser() in every Server Component / Server Action that
 *     reads program data. Don't rely on proxy.ts alone — Server
 *     Functions are NOT in the proxy chain in Next 16.
 *   - Use requirePermission(KEY) for fine-grained gating. Falls back
 *     to requireRole(...) for coarse, role-based gates that pre-date
 *     the permission catalogue.
 *   - SessionUser exposes role + permissions + roleSource. The trace
 *     panel on /settings reads `roleSource` to surface "via DB" vs
 *     "via email bootstrap" vs "default".
 */

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { DashboardRole, RoleSource } from "@/lib/auth-roles";
import type { PermissionKey } from "@/lib/rbac/permissions";

export type { DashboardRole, RoleSource } from "@/lib/auth-roles";

export type SessionUser = {
  email: string;
  displayName: string;
  /** Built-in role mirror — for back-compat with `requireRole(...)`.
   *  A custom role still surfaces here as USER; the `permissions` array
   *  is the real source of truth. */
  role: DashboardRole;
  /** The actual role key (built-in like "ADMIN", or a custom slug like
   *  "auditor"). This is what the /settings/users dropdown reads. */
  roleKey: string;
  /** Permission keys granted by the role. Used by `requirePermission`. */
  permissions: ReadonlyArray<string>;
  /** How the role was resolved. Surfaced on /settings. */
  roleSource: RoleSource;
  /** True if the user has been disabled by an admin. The proxy still
   *  lets the JWT through; privileged routes block on permissions. */
  disabled: boolean;
};

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  const u = session?.user;
  if (!u?.email) return null;
  const v = u as {
    role?: DashboardRole;
    roleKey?: string;
    permissions?: ReadonlyArray<string>;
    roleSource?: RoleSource;
    disabled?: boolean;
  };
  return {
    email: u.email,
    displayName: u.name ?? u.email,
    role: v.role ?? "USER",
    roleKey: v.roleKey ?? "USER",
    permissions: v.permissions ?? [],
    roleSource: v.roleSource ?? { kind: "default" },
    disabled: Boolean(v.disabled),
  };
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/api/auth/signin");
  return u;
}

/**
 * Coarse, role-based gate. Kept for back-compat with v0.2 callsites.
 * For new code, prefer {@link requirePermission}.
 *
 *   const user = await requireRole(["ADMIN", "FINOPS"]);
 */
export async function requireRole(
  allowed: ReadonlyArray<DashboardRole>,
): Promise<SessionUser> {
  const u = await requireUser();
  if (u.disabled) redirect("/?error=disabled");
  if (!allowed.includes(u.role)) redirect("/?error=forbidden");
  return u;
}

/**
 * Permission-based gate. The session's `permissions` array drives this
 * — for the four built-ins, those permissions are seeded from
 * `lib/rbac/built-in-roles.ts`; for custom roles they're whatever the
 * admin picked in /settings/roles.
 *
 *   const user = await requirePermission("users.manage");
 *
 * Pass a single permission or an array (any-of) for "or" semantics.
 */
export async function requirePermission(
  required: PermissionKey | ReadonlyArray<PermissionKey>,
): Promise<SessionUser> {
  const u = await requireUser();
  if (u.disabled) redirect("/?error=disabled");
  const wanted = Array.isArray(required) ? required : [required];
  if (!wanted.some((p) => u.permissions.includes(p))) {
    redirect("/?error=forbidden");
  }
  return u;
}

/**
 * Boolean variant of {@link requirePermission} for places where you
 * want to *render conditionally* rather than redirect. e.g. show a
 * "Manage users" tile only when the user can act on it.
 */
export function userHasPermission(
  user: Pick<SessionUser, "permissions">,
  required: PermissionKey | ReadonlyArray<PermissionKey>,
): boolean {
  const wanted = Array.isArray(required) ? required : [required];
  return wanted.some((p) => user.permissions.includes(p));
}
