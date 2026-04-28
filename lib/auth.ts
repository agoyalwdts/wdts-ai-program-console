/**
 * STUB — v0.1 dev-mode auth.
 *
 * TODO(v0.2): wire to Azure AD via NextAuth (Entra ID provider).
 *   See Dashboard_Scoping_v1.md §4 (Integration #1) and §6 (Q2).
 *   - Add `next-auth` + Azure AD provider.
 *   - Replace `getCurrentUser()` with `getServerSession()`.
 *   - Add a route handler at `app/api/auth/[...nextauth]/route.ts`.
 *   - Add `.cursor/rules/auth.mdc` enforcing 401 on missing session.
 *
 * For v0.1, every page sees the same hardcoded admin user. This is fine
 * for prototype / demo / Steering walkthrough.
 */

export type DevUser = {
  email: string;
  displayName: string;
  role: "ADMIN" | "FINOPS" | "MANAGER" | "USER";
};

export const DEV_USER: DevUser = {
  email: "admin@wdts.com",
  displayName: "Dev Admin",
  role: "ADMIN",
};

export function getCurrentUser(): DevUser {
  return DEV_USER;
}
