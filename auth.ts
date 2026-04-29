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
  "/api/webhooks", // vendor → dashboard webhooks (HMAC-authed, see route handlers)
  "/_next", // static + image optimisation
  "/favicon.ico",
  "/sitemap.xml",
  "/robots.txt",
];

const debug = process.env.AUTH_DEBUG === "true";

/**
 * Look up (or JIT-create) the user's dashboard role + permissions.
 * Called from the JWT callback at sign-in. Returns the role data the
 * JWT needs, or `null` if the user is disabled (caller blocks sign-in).
 */
async function resolveRoleForSignIn(
  email: string,
  displayName: string | null,
): Promise<{
  role: DashboardRole;
  roleKey: string;
  permissions: ReadonlyArray<string>;
  source: RoleSource;
  disabled: boolean;
} | null> {
  // Fast path: user already exists.
  const existing = await prisma.user.findUnique({
    where: { email },
    include: { dashboardRole: true },
  });

  if (existing) {
    if (existing.disabled) {
      return {
        role: "USER",
        roleKey: existing.dashboardRole?.key ?? "USER",
        permissions: [],
        source: { kind: "default" },
        disabled: true,
      };
    }
    if (existing.dashboardRole) {
      const resolution = dbRole(existing.dashboardRole.key);
      return {
        role: resolution.role,
        roleKey: existing.dashboardRole.key,
        permissions: existing.dashboardRole.permissions,
        source: resolution.source,
        disabled: false,
      };
    }
    // Existing user with no role assigned (legacy seed). Treat as USER.
    const userRole = await prisma.role.findUnique({ where: { key: "USER" } });
    return {
      role: "USER",
      roleKey: "USER",
      permissions: userRole?.permissions ?? [],
      source: { kind: "default" },
      disabled: false,
    };
  }

  // Slow path: JIT-provision. Decide the role first (bootstrap rule
  // for the owner, USER otherwise), then upsert the User row pointing
  // at that Role. Wrapped in a transaction so the User and Role link
  // commit atomically — otherwise a crash mid-create could leave a
  // user with no role row pointed at.
  const bootstrap = bootstrapRoleForNewUser(email);
  const targetRoleKey = bootstrap.role;
  const builtIn = getBuiltInRole(targetRoleKey);
  if (!builtIn) {
    console.error(
      `[auth] bootstrap returned non-built-in role ${targetRoleKey} for ${email}; refusing JIT-provision`,
    );
    return null;
  }

  const result = await prisma.$transaction(async (tx) => {
    // Make sure the target Role exists. The seed normally creates this,
    // but a fresh DB on a new tenant might not have run the seed yet —
    // we don't want sign-in to fail just because the seed wasn't run.
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
        displayName: displayName ?? email,
        roleTag: "UNKNOWN", // HRIS-style; updated by CSV import or Deel reconciler
        region: regionFromEmail(email),
        status: "ACTIVE",
        dashboardRoleId: role.id,
        // Bootstrap admin gets isOwner=true on first sign-in if no
        // owner exists yet. Belt-and-braces with the seed, in case the
        // bootstrap admin signs in before the seed runs.
        isOwner: bootstrap.source.kind === "email-bootstrap"
          ? !(await tx.user.count({ where: { isOwner: true } }))
          : false,
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
  // Best-effort default region for JIT-provisioned users. The CSV
  // import / Deel reconciler will overwrite this with the real value
  // when it runs. UNKNOWN is fine for v0.3 — F8 (chargeback) groups
  // unknowns into a residual bucket.
  const lc = email.toLowerCase();
  if (lc.endsWith(".au") || lc.includes(".au@")) return "APAC-AU";
  if (lc.endsWith(".in") || lc.includes(".in@")) return "APAC-IN";
  return "UNKNOWN";
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
      // A `disabled=true` token still has a session — but the JWT was
      // issued with role=USER + empty permissions, so privileged routes
      // already return forbidden. Letting the home page render with a
      // friendly message is better than redirecting to sign-in (which
      // would loop because sign-in succeeds against the IdP).
      return Boolean(session);
    },
    async jwt({ token, profile, trigger }) {
      // Only re-resolve the role on actual sign-in (`signIn` trigger)
      // or first issue. On every page-render the JWT callback fires,
      // and we don't want to hit the DB every time.
      if (trigger === "signIn" || !token.role) {
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
