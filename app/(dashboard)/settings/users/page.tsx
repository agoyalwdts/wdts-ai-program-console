import { Topbar } from "@/components/dashboard/topbar";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UsersTable } from "./users-table";

export const dynamic = "force-dynamic";

export default async function SettingsUsersPage() {
  const actor = await requirePermission(PERMISSIONS.USERS_MANAGE);

  const [users, roles] = await Promise.all([
    prisma.user.findMany({
      orderBy: [
        { isOwner: "desc" },
        { disabled: "asc" },
        { displayName: "asc" },
      ],
      select: {
        id: true,
        email: true,
        displayName: true,
        title: true,
        roleTag: true,
        region: true,
        status: true,
        disabled: true,
        isOwner: true,
        dashboardRole: { select: { key: true, displayName: true } },
        createdAt: true,
      },
    }),
    prisma.role.findMany({
      orderBy: [{ isBuiltIn: "desc" }, { displayName: "asc" }],
      select: {
        id: true,
        key: true,
        displayName: true,
        isBuiltIn: true,
      },
    }),
  ]);

  return (
    <>
      <Topbar
        title="User management"
        subtitle="Assign dashboard roles, enable/disable users. Owner row is protected."
      />
      <div className="p-6 space-y-6 max-w-5xl">
        <Card>
          <CardHeader>
            <CardTitle>Users ({users.length})</CardTitle>
            <CardDescription>
              <strong>Closed by default.</strong> Sign-in is restricted to
              users on this list — anyone else gets a friendly access-denied
              page. Use <em>Invite user</em> to add someone; they can sign in
              the moment the row exists. Role changes take effect on the
              user&apos;s <strong>next sign-in</strong> (JWT is short-lived).
              Disabling kicks in immediately on the user&apos;s next request
              and blocks fresh sign-ins entirely. The owner row cannot be
              demoted, disabled, or transferred via this page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UsersTable
              users={users.map((u) => ({
                id: u.id,
                email: u.email,
                displayName: u.displayName,
                title: u.title,
                roleTag: u.roleTag,
                region: u.region,
                status: u.status,
                disabled: u.disabled,
                isOwner: u.isOwner,
                roleKey: u.dashboardRole?.key ?? "USER",
                createdAt: u.createdAt.toISOString(),
              }))}
              roles={roles}
              actorEmail={actor.email}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
