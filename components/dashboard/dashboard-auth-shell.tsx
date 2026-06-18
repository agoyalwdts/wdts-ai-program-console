import { requireUser } from "@/lib/auth";
import { UserSessionProvider } from "@/components/dashboard/user-session-provider";

/** Resolves session once per layout mount; shared across client navigations. */
export async function DashboardAuthShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  return (
    <UserSessionProvider user={user}>
      <main className="flex-1 min-w-0 flex flex-col">{children}</main>
    </UserSessionProvider>
  );
}
