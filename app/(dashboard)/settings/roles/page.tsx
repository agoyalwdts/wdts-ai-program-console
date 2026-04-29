import Link from "next/link";
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
import { Button } from "@/components/ui/button";
import { Plus, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SettingsRolesPage() {
  await requirePermission(PERMISSIONS.ROLES_MANAGE);

  const roles = await prisma.role.findMany({
    orderBy: [{ isBuiltIn: "desc" }, { displayName: "asc" }],
    include: {
      _count: { select: { users: true } },
    },
  });

  return (
    <>
      <Topbar
        title="Roles & permissions"
        subtitle="Built-in roles + custom roles. Built-in permissions are managed in code; custom roles can be edited freely."
      />
      <div className="p-6 space-y-6 max-w-5xl">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Roles ({roles.length})</CardTitle>
              <CardDescription>
                The four built-ins (USER / MANAGER / FINOPS / ADMIN) are
                always present and cannot be deleted. Add custom roles for
                anything else.
              </CardDescription>
            </div>
            <Button asChild>
              <Link href="/settings/roles/new">
                <Plus className="h-4 w-4" />
                Create custom role
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Role</th>
                    <th className="text-left font-medium px-3 py-2">Type</th>
                    <th className="text-left font-medium px-3 py-2">
                      Permissions
                    </th>
                    <th className="text-left font-medium px-3 py-2">Users</th>
                    <th className="text-right font-medium px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900">
                          {r.displayName}
                        </div>
                        <div className="text-xs text-slate-500 font-mono">
                          {r.key}
                        </div>
                        {r.description ? (
                          <div className="text-xs text-slate-600 mt-0.5">
                            {r.description}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        {r.isBuiltIn ? (
                          <Badge variant="secondary">Built-in</Badge>
                        ) : (
                          <Badge variant="success">Custom</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {r.permissions.length} of {PERMISSION_CATALOG.length}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {r._count.users}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Link
                          href={`/settings/roles/${r.id}`}
                          className="inline-flex items-center gap-1 text-sm text-sky-700 hover:text-sky-900 underline-offset-4 hover:underline"
                        >
                          {r.isBuiltIn ? "View" : "Edit"}
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Permission catalogue</CardTitle>
            <CardDescription>
              All {PERMISSION_CATALOG.length} permissions the dashboard
              checks. Built-in role assignments come from{" "}
              <code className="font-mono">lib/rbac/built-in-roles.ts</code>;
              custom roles pick from this list.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-slate-700 space-y-3">
            {[
              "Dashboard",
              "Operations",
              "Admin",
              "Future write paths",
            ].map((cat) => {
              const items = PERMISSION_CATALOG.filter(
                (p) => p.category === cat,
              );
              if (items.length === 0) return null;
              return (
                <div key={cat}>
                  <div className="font-medium text-slate-900 mb-1">{cat}</div>
                  <ul className="space-y-1">
                    {items.map((p) => (
                      <li key={p.key} className="ml-2">
                        <code className="font-mono text-xs text-sky-700">
                          {p.key}
                        </code>{" "}
                        — <span className="font-medium">{p.displayName}</span>:{" "}
                        <span className="text-slate-600">{p.description}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
