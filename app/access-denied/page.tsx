/**
 * Public access-denied page. Reachable without a session — the
 * `signIn` callback redirects here when the OAuth identity is not
 * on the dashboard's allowlist (or the User row is disabled).
 *
 * Listed in `PUBLIC_PATHS` in `auth.ts` so the proxy doesn't bounce
 * the user back to sign-in.
 */

import Link from "next/link";
import { ShieldAlert, Mail, LogOut } from "lucide-react";

export const dynamic = "force-dynamic";

const OWNER_EMAIL = "agoyal@wdtablesystems.com";

type Props = {
  searchParams: Promise<{
    reason?: string;
    email?: string;
  }>;
};

export default async function AccessDeniedPage({ searchParams }: Props) {
  const { reason, email } = await searchParams;
  const headline = headlineFor(reason);
  const body = bodyFor(reason, email);

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white shadow-sm p-8 space-y-6">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-rose-50 p-2">
            <ShieldAlert className="h-6 w-6 text-rose-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              {headline}
            </h1>
            <p className="text-sm text-slate-500">
              WDTS AI Program Console
            </p>
          </div>
        </div>

        {email ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-500">Signed in as: </span>
            <code className="font-mono text-slate-900 break-all">{email}</code>
          </div>
        ) : null}

        <div className="text-sm text-slate-700 leading-relaxed space-y-3">
          {body}
        </div>

        <div className="space-y-2 pt-2">
          <a
            href={`mailto:${OWNER_EMAIL}?subject=${encodeURIComponent(
              "Access request — WDTS AI Program Console",
            )}&body=${encodeURIComponent(
              `Hi Anuj,\n\nI tried to sign in to the WDTS AI Program Console as ${
                email ?? "(my work account)"
              } but got an access-denied page. Could you please add me?\n\nThanks`,
            )}`}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition w-full sm:w-auto"
          >
            <Mail className="h-4 w-4" />
            Email {OWNER_EMAIL}
          </a>
          <div className="text-xs text-slate-500">
            Or, if you signed in with the wrong account, sign out and try
            another:
          </div>
          <Link
            href="/api/auth/signout"
            className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition w-full sm:w-auto"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Link>
        </div>
      </div>
    </main>
  );
}

function headlineFor(reason: string | undefined): string {
  switch (reason) {
    case "disabled":
      return "Your account has been disabled";
    case "not-invited":
      return "You don't have access to this dashboard";
    case "no-email":
      return "We couldn't read an email from your sign-in";
    case "error":
      return "Something went wrong while checking access";
    default:
      return "You don't have access to this dashboard";
  }
}

function bodyFor(
  reason: string | undefined,
  email: string | undefined,
): React.ReactNode {
  switch (reason) {
    case "disabled":
      return (
        <>
          <p>
            An admin has disabled this account. If you believe this is a
            mistake, contact the dashboard owner below.
          </p>
        </>
      );
    case "not-invited":
      return (
        <>
          <p>
            The WDTS AI Program Console is restricted to a small group of
            AI Task Force and ExCo members today. Your Microsoft account{" "}
            {email ? <strong>{email}</strong> : "(unknown)"} isn&apos;t on
            the access list yet.
          </p>
          <p>
            If you should have access, ask the dashboard owner to add you
            from <code className="font-mono text-xs">/settings/users</code>.
            They&apos;ll need your work email — that&apos;s the only thing
            required.
          </p>
        </>
      );
    case "no-email":
      return (
        <>
          <p>
            Your sign-in didn&apos;t include an email claim, so we
            can&apos;t look you up against the access list. Sign out and
            try again, or contact the owner.
          </p>
        </>
      );
    case "error":
      return (
        <>
          <p>
            The access check threw an error. This is usually transient —
            sign out and try again. If it persists, contact the owner.
          </p>
        </>
      );
    default:
      return (
        <>
          <p>
            Sign-in succeeded against Microsoft Entra, but the dashboard
            doesn&apos;t recognise your account on its access list. Ask
            the owner to add you.
          </p>
        </>
      );
  }
}
