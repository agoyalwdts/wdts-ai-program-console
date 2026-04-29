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
 *   - Use getCurrentUser() ONLY when the page is genuinely public-aware
 *     (e.g. an error / sign-in landing). v0.2 has none.
 *   - DashboardRole is sourced from Auth.js's `session.user.role` which
 *     is populated by the JWT callback in auth.ts via roleFromClaims().
 */

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { DashboardRole, RoleSource } from "@/lib/auth-roles";

export type { DashboardRole, RoleSource } from "@/lib/auth-roles";

export type SessionUser = {
  email: string;
  displayName: string;
  role: DashboardRole;
  /** How the role was resolved. Surfaced on /settings so an operator can
   *  tell at a glance whether they're sitting on the v0.2 email fallback
   *  or on the production group-claim path. */
  roleSource: RoleSource;
  /** Raw AAD `groups` claim from the JWT. Empty if the AAD app reg
   *  isn't emitting groups (which would itself be a bug post-v0.2). */
  groups: string[];
};

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  const u = session?.user;
  if (!u?.email) return null;
  const role =
    ((u as { role?: DashboardRole }).role as DashboardRole | undefined) ??
    "USER";
  const roleSource =
    ((u as { roleSource?: RoleSource }).roleSource as
      | RoleSource
      | undefined) ?? { kind: "default" };
  const groups =
    ((u as { groups?: string[] }).groups as string[] | undefined) ?? [];
  return {
    email: u.email,
    displayName: u.name ?? u.email,
    role,
    roleSource,
    groups,
  };
}

/**
 * Throws → redirects to sign-in if no session. Use this in every Server
 * Component that renders program data. The proxy already redirects
 * unauthenticated requests, so under normal flow this only fires if the
 * proxy was bypassed (Server Function path) or the session expired
 * mid-render.
 */
export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/api/auth/signin");
  return u;
}

/**
 * Role-gating helper. Throws (via redirect) if the user lacks any of the
 * allowed roles. Wire into Server Actions + privileged routes.
 *
 *   const user = await requireRole(["ADMIN", "FINOPS"]);
 */
export async function requireRole(
  allowed: ReadonlyArray<DashboardRole>,
): Promise<SessionUser> {
  const u = await requireUser();
  if (!allowed.includes(u.role)) redirect("/?error=forbidden");
  return u;
}
