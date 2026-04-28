/**
 * Next.js 16 proxy.ts (was middleware.ts in <=15). Wires Auth.js v5 in
 * "middleware mode" so every matched request runs through the
 * `authorized` callback in auth.ts. Unauthenticated users are redirected
 * to /api/auth/signin.
 *
 * Server Functions are NOT covered by proxy (per Next 16 docs); each
 * Server Component / Server Action MUST also call `requireUser()` from
 * lib/auth.ts to prevent a refactor from silently dropping coverage.
 */

export { auth as proxy } from "@/auth";

/**
 * Run on every request EXCEPT static assets, image optimisation outputs,
 * and the Next.js internal RSC payloads. The actual auth gating happens
 * in the `authorized` callback (auth.ts) which has access to the parsed
 * session and can let /api/auth/* through itself.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt).*)",
  ],
};
