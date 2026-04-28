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
import { roleFromClaims } from "@/lib/auth-roles";
import type { DashboardRole } from "@/lib/auth-roles";

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
  "/_next", // static + image optimisation
  "/favicon.ico",
  "/sitemap.xml",
  "/robots.txt",
];

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: clientId ?? "",
      clientSecret: clientSecret ?? "",
      issuer: tenantId
        ? `https://login.microsoftonline.com/${tenantId}/v2.0`
        : undefined,
    }),
  ],
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
      // Compute role once at sign-in / first JWT issue. AAD `groups` claim
      // requires app-registration configuration (Token configuration →
      // groupMembershipClaims=SecurityGroup) which we'll wire after the
      // first signed-in user; until then roles fall back to email rules.
      const groupsClaim = (profile as { groups?: string[] } | undefined)?.groups;
      const role: DashboardRole = roleFromClaims({
        email: token.email ?? "",
        groups: groupsClaim,
      });
      token.role = role;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email ?? session.user.email;
        session.user.name = token.name ?? session.user.name;
        (session.user as { role?: DashboardRole }).role =
          (token.role as DashboardRole) ?? "USER";
      }
      return session;
    },
  },
});
