/**
 * Auth.js v5 (next-auth@beta) root configuration.
 *
 * The convention is for this file to live at the project root (NOT
 * `lib/auth.ts`) — Auth.js docs assume that and so does the proxy.ts at
 * the root. `lib/auth.ts` continues to exist as the dashboard-facing
 * auth helper; it re-exports from here.
 *
 * v0.2 wiring per scoping §4 integration #1:
 *   - Microsoft Entra ID (Azure AD) provider, JWT session strategy.
 *   - Strict gating: every route requires a session except /api/auth/*
 *     and the public Next.js asset paths. Implemented in the
 *     `authorized` callback (used by Auth.js's auth() middleware export).
 *   - Roles are derived from email matching (sandbox / single-user
 *     tenant); production should read AAD group claims via the OIDC
 *     `groups` claim. See lib/auth.ts roleFromClaims().
 */

import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { roleFromClaimsWithTrace } from "@/lib/auth-roles";
import type { DashboardRole, RoleSource } from "@/lib/auth-roles";

const tenantId = process.env.AZURE_AD_TENANT_ID;
const clientId = process.env.AZURE_AD_CLIENT_ID;
const clientSecret = process.env.AZURE_AD_CLIENT_SECRET;

if (!tenantId || !clientId || !clientSecret) {
  // Surface the missing var early — otherwise NextAuth fails opaquely on
  // the first sign-in attempt. In CI / tests the proxy short-circuits
  // before this matters; see tests/setup-files.ts.
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

// AUTH_DEBUG=true unmasks the underlying error for /api/auth/error?error=Configuration
// (MissingSecret, OAuthCallbackError, JWTSessionError, etc.). Off by default
// because debug logging includes the full token payload. Toggle on the App
// Service via `az webapp config appsettings set ... AUTH_DEBUG=true`, then
// turn it back off once the root cause is captured.
const debug = process.env.AUTH_DEBUG === "true";

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
    /**
     * Used by `auth()` when re-exported as the `proxy` (Next.js 16
     * proxy.ts) — Auth.js calls this on every matched request to decide
     * whether to allow it through. Return:
     *   true        → continue
     *   false       → redirect to /api/auth/signin
     *   Response    → custom redirect / response
     */
    authorized({ auth: session, request }) {
      const path = request.nextUrl.pathname;
      if (PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"))) {
        return true;
      }
      return Boolean(session);
    },
    async jwt({ token, profile }) {
      if (profile?.email) token.email = profile.email;
      // Microsoft Entra returns the user's display name in `name`.
      if (profile?.name) token.name = profile.name;
      // Compute role once at sign-in / first JWT issue. The mapping is:
      //   1. AAD `groups` claim → role, via the env-driven map in
      //      lib/auth-roles.ts (AZURE_AD_GROUP_*_IDS env vars).
      //   2. Email-pattern rules in lib/auth-roles.ts (sandbox bridge).
      //   3. Default USER.
      // Step 1 requires the AAD app registration to emit a `groups` claim
      // (Token configuration → groupMembershipClaims=SecurityGroup) AND
      // the env vars to be set. When neither is true, step 2 takes over.
      const groupsClaim = (profile as { groups?: string[] } | undefined)?.groups;
      const trace = roleFromClaimsWithTrace({
        email: token.email ?? "",
        groups: groupsClaim,
      });
      token.role = trace.role;
      token.roleSource = trace.source;
      // Persist groups (count + the OIDs themselves) so the /settings
      // panel can show "you're in 14 AAD groups; here are the OIDs"
      // without re-issuing the token. OIDs are non-secret (they leak
      // group structure but not membership content).
      if (groupsClaim) token.groups = groupsClaim;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email ?? session.user.email;
        session.user.name = token.name ?? session.user.name;
        const u = session.user as {
          role?: DashboardRole;
          roleSource?: RoleSource;
          groups?: string[];
        };
        u.role = (token.role as DashboardRole) ?? "USER";
        u.roleSource = (token.roleSource as RoleSource | undefined) ?? {
          kind: "default",
        };
        u.groups = (token.groups as string[] | undefined) ?? [];
      }
      return session;
    },
  },
});
