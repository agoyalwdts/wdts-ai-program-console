/**
 * Pure role-mapping logic, separated from Auth.js wiring so Vitest can
 * unit-test it without spinning up next-auth.
 *
 * v0.2 default rule: AAD `groups` claim wins; if absent, fall back to an
 * email-domain / specific-email rule. Tweak this list in lockstep with
 * the AAD app-registration "Token configuration → groupMembershipClaims"
 * policy. Production should rely on group claims only; the email rules
 * are a sandbox bridge.
 */

export type DashboardRole = "ADMIN" | "FINOPS" | "MANAGER" | "USER";

/** Stable AAD group → dashboard role mapping. Update when the actual
 *  groups exist in the tenant. */
export const GROUP_ROLE_MAP: Record<string, DashboardRole> = {
  // Replace with real AAD group object IDs once the groups are created.
  // "00000000-0000-0000-0000-000000000001": "ADMIN",
  // "00000000-0000-0000-0000-000000000002": "FINOPS",
  // "00000000-0000-0000-0000-000000000003": "MANAGER",
};

/** Email-rule fallback for the sandbox tenant. Match in order; first hit wins.
 *  Empty rules array means everyone signed in gets USER. */
export const EMAIL_ROLE_RULES: Array<{ pattern: RegExp; role: DashboardRole }> = [
  // Anuj is the sandbox-tenant owner; treat any matching email as ADMIN
  // until real AAD groups exist. Tightened in v0.3.
  { pattern: /^anuj(\.|@)/i, role: "ADMIN" },
  { pattern: /finops@/i, role: "FINOPS" },
  { pattern: /^manager(s)?@/i, role: "MANAGER" },
];

export function roleFromClaims(args: {
  email: string;
  groups?: string[];
}): DashboardRole {
  for (const g of args.groups ?? []) {
    const role = GROUP_ROLE_MAP[g];
    if (role) return role;
  }
  for (const rule of EMAIL_ROLE_RULES) {
    if (rule.pattern.test(args.email)) return rule.role;
  }
  return "USER";
}
