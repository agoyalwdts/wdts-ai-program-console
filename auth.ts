/**
 * Auth.js v5 (next-auth@beta) root configuration.
 *
 * The convention is for this file to live at the project root (NOT
 * `lib/auth.ts`) — Auth.js docs assume that and so does the proxy.ts at
 * the root. `lib/auth.ts` continues to exist as the dashboard-facing
 * auth helper; it re-exports from here.
 *
 * v0.3 wiring (LDR 0005 — app-level RBAC):
 *   - Microsoft Entra ID (Azure AD) provider, JWT session strategy.
 *   - On first sign-in, JIT-provision a `User` row in Postgres with
 *     role=USER (or ADMIN if the email matches the bootstrap-owner
 *     rule). Subsequent sign-ins read role+permissions straight from
 *     the DB via the user's `dashboardRoleId` FK.
 *   - Disabled users are blocked at the `authorized` callback boundary.
 *   - Roles are NOT derived from the IdP's `groups` claim. See LDR 0005.
 */

import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { prisma } from "@/lib/prisma";
import {
  bootstrapRoleForNewUser,
  dbRole,
  isBootstrapAdmin,
} from "@/lib/auth-roles";
import type { DashboardRole, RoleSource } from "@/lib/auth-roles";
import { getBuiltInRole } from "@/lib/rbac/built-in-roles";

const tenantId = process.env.AZURE_AD_TENANT_ID;
const clientId = process.env.AZURE_AD_CLIENT_ID;
const clientSecret = process.env.AZURE_AD_CLIENT_SECRET;

if (!tenantId || !clientId || !clientSecret) {
  console.warn(
    "[auth] Missing AZURE_AD_TENANT_ID / AZURE_AD_CLIENT_ID / AZURE_AD_CLIENT_SECRET. " +
      "Sign-in will 500 until these are set in .env.local.",
  );
}

const PUBLIC_PATHS = [
  "/api/auth", // Auth.js endpoints
  "/api/health", // liveness — no secrets; see app/api/health/route.ts
  "/api/webhooks", // vendor → dashboard webhooks (HMAC-authed, see route handlers)
  "/api/cron", // external cron triggers (HMAC-authed via lib/cron/auth.ts)
  "/access-denied", // shown to non-invited users after OAuth — must be reachable without a session
  "/_next", // static + image optimisation
  "/favicon.ico",
  "/sitemap.xml",
  "/robots.txt",
];

const debug = process.env.AUTH_DEBUG === "true";

/**
 * Bump this whenever the shape of the JWT we issue changes — i.e.
 * whenever {@link resolveRoleForSignIn} starts writing a new field
 * onto the token, or stops writing one. The JWT callback re-resolves
 * the token from the database whenever the cookie's stamped version
 * doesn't match this constant, which auto-heals every existing
 * session on its next request after a deploy.
 *
 * Without this, an old cookie minted by a previous build keeps
 * round-tripping through the callback unchanged (because Auth.js
 * preserves whatever fields it already has), and downstream code
 * sees a half-populated session.
 *
 * Version history:
 *   1 — v0.2 shape: { role }.
 *   2 — v0.3 shape: { role, roleKey, permissions, roleSource, disabled }.
 *   3 — built-in roles take permissions from code catalogue (getBuiltInRole)
 *       so new keys ship without a DB seed on every deploy.
 *   4 — legacy users without dashboardRoleId now resolve USER permissions
 *       via the same catalogue path (fixes stale/missing dashboard.view_*).
 */
const TOKEN_SCHEMA_VERSION = 4;

/** Built-in roles always use the code catalogue; custom roles use DB. */
function effectiveDashboardPermissions(role: {
  key: string;
  isBuiltIn: boolean;
  permissions: string[];
}): string[] {
  if (role.isBuiltIn) {
    const def = getBuiltInRole(role.key);
    if (def) return [...def.permissions];
  }
  return role.permissions;
}

/**
 * Look up the user's dashboard role + permissions, or JIT-provision
 * the bootstrap admin on their first sign-in.
 *
 * The `signIn` callback has already enforced the closed-by-default
 * gate — if we reach this function, exactly one of these is true:
 *   1. A User row exists for this email.
 *   2. The email matches a bootstrap-admin rule and no row exists yet.
 * Anything else has already been redirected to /access-denied.
 *
 * Refreshes `displayName` from the IdP profile on first sign-in if
 * the invite-time placeholder still equals the email (a tiny UX
 * polish so the topbar shows a real name instead of an email).
 */
async function resolveRoleForSignIn(
  email: string,
  profileName: string | null,
): Promise<{
  role: DashboardRole;
  roleKey: string;
  permissions: ReadonlyArray<string>;
  source: RoleSource;
  disabled: boolean;
} | null> {
  const existing = await prisma.user.findUnique({
    where: { email },
    include: { dashboardRole: true },
  });

  if (existing) {
    // Defensive double-check — the signIn callback should have caught
    // this, but if a session somehow resurrects after a disable we
    // fail closed.
    if (existing.disabled) {
      return {
        role: "USER",
        roleKey: existing.dashboardRole?.key ?? "USER",
        permissions: [],
        source: { kind: "default" },
        disabled: true,
      };
    }

    // First-sign-in displayName refresh: invitee got created with
    // displayName=email (because the inviter only knew the email);
    // now that they've actually signed in we have a real name from
    // the IdP. Update it once and never again — the owner stays in
    // control of the field via /settings/users.
    if (
      profileName &&
      profileName.trim() &&
      existing.displayName === email
    ) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { displayName: profileName.trim() },
      });
    }

    if (existing.dashboardRole) {
      const resolution = dbRole(existing.dashboardRole.key);
      return {
        role: resolution.role,
        roleKey: existing.dashboardRole.key,
        permissions: effectiveDashboardPermissions(existing.dashboardRole),
        source: resolution.source,
        disabled: false,
      };
    }
    // Existing user with no role assigned (legacy seed). Treat as USER.
    // Must use effectiveDashboardPermissions — not raw Role.permissions —
    // so built-in USER picks up new catalogue keys (e.g. dashboard.view_analytics).
    const userRole = await prisma.role.findUnique({ where: { key: "USER" } });
    const builtInUser = getBuiltInRole("USER");
    return {
      role: "USER",
      roleKey: "USER",
      permissions: userRole
        ? effectiveDashboardPermissions(userRole)
        : [...(builtInUser?.permissions ?? [])],
      source: { kind: "default" },
      disabled: false,
    };
  }

  // No row + signIn callback let us through ⇒ this must be the
  // bootstrap admin's first sign-in. JIT-provision them as ADMIN +
  // owner.
  const bootstrap = bootstrapRoleForNewUser(email);
  if (bootstrap.source.kind !== "email-bootstrap") {
    // Shouldn't happen — signIn guards this. Fail closed loudly.
    console.error(
      `[auth] resolveRoleForSignIn reached for non-bootstrap email "${email}" ` +
        `with no User row. signIn gate is broken. Refusing.`,
    );
    return null;
  }
  const builtIn = getBuiltInRole(bootstrap.role);
  if (!builtIn) {
    console.error(
      `[auth] bootstrap returned non-built-in role ${bootstrap.role} for ${email}`,
    );
    return null;
  }

  const result = await prisma.$transaction(async (tx) => {
    const role = await tx.role.upsert({
      where: { key: builtIn.key },
      update: {},
      create: {
        key: builtIn.key,
        displayName: builtIn.displayName,
        description: builtIn.description,
        isBuiltIn: true,
        permissions: [...builtIn.permissions],
      },
    });

    const user = await tx.user.create({
      data: {
        email,
        displayName: profileName?.trim() || email,
        roleTag: "EXEC",
        region: regionFromEmail(email),
        status: "ACTIVE",
        dashboardRoleId: role.id,
        isOwner: !(await tx.user.count({ where: { isOwner: true } })),
      },
    });

    return { user, role };
  });

  return {
    role: bootstrap.role,
    roleKey: result.role.key,
    permissions: result.role.permissions,
    source: bootstrap.source,
    disabled: false,
  };
}

function regionFromEmail(email: string): string {
  const lc = email.toLowerCase();
  if (lc.endsWith(".au") || lc.includes(".au@")) return "APAC-AU";
  if (lc.endsWith(".in") || lc.includes(".in@")) return "APAC-IN";
  return "UNKNOWN";
}

/**
 * Decide whether `email` is allowed to sign in. Closed-by-default
 * (LDR 0005): an email that has no User row AND doesn't match a
 * bootstrap-admin rule is rejected at the OAuth callback. Disabled
 * users are also rejected here.
 *
 * Returns either `true` (allow) or a `/access-denied?...` URL
 * (Auth.js redirects the browser to whatever string we return).
 */
async function decideSignInAccess(email: string): Promise<true | string> {
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, disabled: true },
  });
  if (existing) {
    if (existing.disabled) {
      return `/access-denied?reason=disabled&email=${encodeURIComponent(email)}`;
    }
    return true;
  }
  if (isBootstrapAdmin(email)) return true;
  return `/access-denied?reason=not-invited&email=${encodeURIComponent(email)}`;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  debug,
  providers: [
    MicrosoftEntraID({
      clientId: clientId ?? "",
      clientSecret: clientSecret ?? "",
      issuer: tenantId
        ? `https://login.microsoftonline.com/${tenantId}/v2.0`
        : undefined,
    }),
  ],
  logger: {
    error(error) {
      console.error("[auth][error]", error?.name, error?.message, error?.stack);
    },
    warn(code) {
      console.warn("[auth][warn]", code);
    },
    debug(message, metadata) {
      if (debug) console.log("[auth][debug]", message, metadata);
    },
  },
  session: { strategy: "jwt" },
  callbacks: {
    authorized({ auth: session, request }) {
      const path = request.nextUrl.pathname;
      if (PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"))) {
        return true;
      }
      return Boolean(session);
    },
    /**
     * Closed-by-default access gate (LDR 0005). Runs after the IdP
     * confirms the OAuth identity but before the JWT is issued. Allow
     * sign-in only if a User row exists (= invited via /settings/users)
     * OR the email matches a bootstrap-admin rule. Disabled users are
     * rejected here too. Returning a string redirects the browser there.
     */
    async signIn({ profile }) {
      const email = profile?.email?.toLowerCase().trim();
      if (!email) {
        console.warn("[auth][signIn] denied — no email on profile");
        return "/access-denied?reason=no-email";
      }
      try {
        return await decideSignInAccess(email);
      } catch (e) {
        console.error("[auth][signIn] gate threw; failing closed", e);
        return "/access-denied?reason=error";
      }
    },
    async jwt({ token, profile, trigger }) {
      // Re-resolve from DB on:
      //   - actual sign-in (`signIn` trigger), or
      //   - first issue (no role on token), or
      //   - stamped schema version doesn't match the current code
      //     (i.e. the cookie predates a JWT shape change). This is the
      //     auto-heal path — without it, a v0.2 cookie that has
      //     `token.role="ADMIN"` but no `permissions[]` keeps slipping
      //     through every request unchanged and downstream
      //     `requirePermission` gates fail closed.
      // Otherwise the JWT callback is a hot path on every page render,
      // so we skip the DB read.
      const needsResolve =
        trigger === "signIn" ||
        !token.role ||
        token.tokenSchemaVersion !== TOKEN_SCHEMA_VERSION;

      if (needsResolve) {
        if (profile?.email) token.email = profile.email;
        if (profile?.name) token.name = profile.name;
        try {
          const resolved = await resolveRoleForSignIn(
            token.email ?? "",
            (token.name as string | undefined) ?? null,
          );
          if (resolved) {
            token.role = resolved.role;
            token.roleKey = resolved.roleKey;
            token.permissions = resolved.permissions;
            token.roleSource = resolved.source;
            token.disabled = resolved.disabled;
          } else {
            token.role = "USER";
            token.roleKey = "USER";
            token.permissions = [];
            token.roleSource = { kind: "default" };
            token.disabled = false;
          }
        } catch (e) {
          console.error("[auth] resolveRoleForSignIn threw", e);
          // Fail closed — caller gets USER + no permissions. Better
          // than throwing, which would surface as Configuration error
          // to the user with no actionable hint.
          token.role = "USER";
          token.roleKey = "USER";
          token.permissions = [];
          token.roleSource = { kind: "default" };
          token.disabled = false;
        }
        // Stamp the version *after* the resolve completes (or fails
        // closed). Even on the failure path we record that we attempted
        // a resolve at this schema version so the next request doesn't
        // burn another DB query.
        token.tokenSchemaVersion = TOKEN_SCHEMA_VERSION;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email ?? session.user.email;
        session.user.name = token.name ?? session.user.name;
        const u = session.user as {
          role?: DashboardRole;
          roleKey?: string;
          permissions?: ReadonlyArray<string>;
          roleSource?: RoleSource;
          disabled?: boolean;
        };
        u.role = (token.role as DashboardRole) ?? "USER";
        u.roleKey = (token.roleKey as string | undefined) ?? "USER";
        u.permissions = (token.permissions as ReadonlyArray<string>) ?? [];
        u.roleSource = (token.roleSource as RoleSource | undefined) ?? {
          kind: "default",
        };
        u.disabled = Boolean(token.disabled);
      }
      return session;
    },
  },
});
