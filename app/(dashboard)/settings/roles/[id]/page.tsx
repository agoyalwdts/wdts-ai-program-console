import { notFound } from "next/navigation";
import { Topbar } from "@/components/dashboard/topbar";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS, PERMISSION_CATALOG } from "@/lib/rbac/permissions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EditRoleForm } from "./edit-role-form";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function RoleDetailPage({ params }: Props) {
  await requirePermission(PERMISSIONS.ROLES_MANAGE);
  const { id } = await params;

  const role = await prisma.role.findUnique({
    where: { id },
    include: { _count: { select: { users: true } } },
  });
  if (!role) notFound();

  return (
    <>
      <Topbar
        title={role.displayName}
        subtitle={
          role.isBuiltIn
            ? "Built-in role — name + description editable; permissions are managed in code."
            : "Custom role — full edit + delete."
        }
      />
      <div className="p-6 max-w-3xl space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>{role.displayName}</CardTitle>
              <CardDescription>
                <code className="font-mono text-xs">{role.key}</code> ·{" "}
                {role._count.users} user{role._count.users === 1 ? "" : "s"}
                {" "}assigned
              </CardDescription>
            </div>
            {role.isBuiltIn ? (
              <Badge variant="secondary">Built-in</Badge>
            ) : (
              <Badge variant="success">Custom</Badge>
            )}
          </CardHeader>
          <CardContent>
            <EditRoleForm
              roleId={role.id}
              roleKey={role.key}
              isBuiltIn={role.isBuiltIn}
              userCount={role._count.users}
              initial={{
                displayName: role.displayName,
                description: role.description ?? "",
                permissions: role.permissions,
              }}
              catalog={[...PERMISSION_CATALOG]}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
