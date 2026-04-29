import { Topbar } from "@/components/dashboard/topbar";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS, PERMISSION_CATALOG } from "@/lib/rbac/permissions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CreateRoleForm } from "./create-role-form";

export const dynamic = "force-dynamic";

export default async function NewRolePage() {
  await requirePermission(PERMISSIONS.ROLES_MANAGE);

  return (
    <>
      <Topbar
        title="Create custom role"
        subtitle="Pick a slug, name, and the permission set this role grants."
      />
      <div className="p-6 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>New role</CardTitle>
            <CardDescription>
              Slug is permanent (used in audit logs and code-side
              permission checks). Display name and description can be
              edited later. Pick the permissions you want this role to
              grant — the catalogue below is the complete list of
              dashboard-enforced checks.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateRoleForm catalog={[...PERMISSION_CATALOG]} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
