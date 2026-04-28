/**
 * Pure role-mapping logic, separated from Auth.js wiring so Vitest can
 * unit-test it without spinning up next-auth.
 *
 * Decision order on every sign-in:
 *
 *   1. AAD groups claim is consulted first. The group → role mapping is
 *      env-driven (see ENV_GROUP_VARS below) so a future agent can wire
 *      real AAD security groups without editing code. An empty mapping
 *      falls through to step 2.
 *   2. Email-pattern rules (sandbox bridge). Useful while the production
 *      AAD groups haven't been created yet. Hard-coded in code because
 *      an env-driven regex list is a foot-gun.
 *   3. Default: USER.
 *
 * Production posture: every role except USER should come from a group
 * claim. The email rules are deliberately scoped to the sandbox tenant
 * and should be tightened (or deleted) once real groups exist.
 */

export type DashboardRole = "ADMIN" | "FINOPS" | "MANAGER" | "USER";

export const DASHBOARD_ROLES: ReadonlyArray<DashboardRole> = [
  "ADMIN",
  "FINOPS",
  "MANAGER",
  "USER",
];

/**
 * Env vars that, if set, populate {@link GROUP_ROLE_MAP}. Comma-separated
 * lists of AAD group object IDs (UUIDs) — one var per role.
 *
 * Set in `.env.local` (gitignored). For production these would live in
 * the prod secret store. Never commit real group IDs to `.env` — they
 * aren't secret per se, but they leak the org structure of the tenant.
 *
 * Precedence inside the env map: the FIRST role whose env var contains
 * a matching group ID wins. With the order below, that's ADMIN > FINOPS
 * > MANAGER, which matches the role hierarchy.
 */
export const ENV_GROUP_VARS = [
  { role: "ADMIN" as const, env: "AZURE_AD_GROUP_ADMIN_IDS" },
  { role: "FINOPS" as const, env: "AZURE_AD_GROUP_FINOPS_IDS" },
  { role: "MANAGER" as const, env: "AZURE_AD_GROUP_MANAGER_IDS" },
];

/**
 * Build the group → role lookup table from env. Exported so tests can
 * exercise it; auth.ts and the dashboard call {@link roleFromClaims}
 * which calls this lazily on every claim resolution. Lazy is correct
 * here because Auth.js may load this module before `.env.local` is
 * fully merged into `process.env` in some Node versions.
 */
export function loadGroupRoleMap(
  env: Record<string, string | undefined> = process.env,
): Record<string, DashboardRole> {
  const out: Record<string, DashboardRole> = {};
  for (const { role, env: key } of ENV_GROUP_VARS) {
    const raw = env[key];
    if (!raw) continue;
    for (const id of raw.split(",")) {
      const trimmed = id.trim();
      if (!trimmed) continue;
      // First-write-wins so ADMIN > FINOPS > MANAGER if a group was
      // listed in two env vars by mistake. Caller's intent is preserved.
      if (!(trimmed in out)) out[trimmed] = role;
    }
  }
  return out;
}

/**
 * Hard-coded baseline for tests + a safety net if env loading fails.
 * Real group IDs land via env (see {@link ENV_GROUP_VARS}); this stays
 * empty so accidentally rebuilding without env vars doesn't grant
 * anyone a privileged role.
 */
export const GROUP_ROLE_MAP: Record<string, DashboardRole> = {};

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
  /** Optional override — tests pass a fixed map; production reads env. */
  groupRoleMap?: Record<string, DashboardRole>;
}): DashboardRole {
  const map = args.groupRoleMap ?? loadGroupRoleMap();
  for (const g of args.groups ?? []) {
    const role = map[g];
    if (role) return role;
  }
  for (const rule of EMAIL_ROLE_RULES) {
    if (rule.pattern.test(args.email)) return rule.role;
  }
  return "USER";
}
