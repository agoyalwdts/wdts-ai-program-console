"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, ShieldOff, Crown } from "lucide-react";

export type UserRow = {
  id: string;
  email: string;
  displayName: string;
  title: string | null;
  roleTag: string;
  region: string;
  status: string;
  disabled: boolean;
  isOwner: boolean;
  roleKey: string;
  createdAt: string;
};

export type RoleOption = {
  id: string;
  key: string;
  displayName: string;
  isBuiltIn: boolean;
};

export function UsersTable({
  users,
  roles,
  actorEmail,
}: {
  users: ReadonlyArray<UserRow>;
  roles: ReadonlyArray<RoleOption>;
  actorEmail: string;
}) {
  const [filter, setFilter] = React.useState("");
  const [rows, setRows] = React.useState<UserRow[]>([...users]);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<{ id: string; msg: string } | null>(
    null,
  );

  const filtered = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.email.toLowerCase().includes(q) ||
        r.displayName.toLowerCase().includes(q) ||
        r.roleKey.toLowerCase().includes(q) ||
        (r.title ?? "").toLowerCase().includes(q),
    );
  }, [rows, filter]);

  async function changeRole(user: UserRow, roleKey: string) {
    if (roleKey === user.roleKey) return;
    setBusyId(user.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/role`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleKey }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError({ id: user.id, msg: json.error ?? "Request failed" });
        return;
      }
      setRows((rs) =>
        rs.map((r) => (r.id === user.id ? { ...r, roleKey } : r)),
      );
    } catch (e) {
      setError({ id: user.id, msg: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  }

  async function toggleDisabled(user: UserRow, disabled: boolean) {
    setBusyId(user.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/disabled`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ disabled }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError({ id: user.id, msg: json.error ?? "Request failed" });
        return;
      }
      setRows((rs) =>
        rs.map((r) => (r.id === user.id ? { ...r, disabled } : r)),
      );
    } catch (e) {
      setError({ id: user.id, msg: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by email, name, role…"
          className="max-w-sm"
        />
        <div className="text-xs text-slate-500">
          Showing {filtered.length} / {rows.length}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left font-medium px-3 py-2">User</th>
              <th className="text-left font-medium px-3 py-2">Role</th>
              <th className="text-left font-medium px-3 py-2">Status</th>
              <th className="text-right font-medium px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => {
              const isSelf = u.email === actorEmail;
              const protectedRow = u.isOwner;
              const rowError =
                error && error.id === u.id ? error.msg : undefined;
              return (
                <tr
                  key={u.id}
                  className={`border-t border-slate-100 ${u.disabled ? "bg-rose-50/30" : ""}`}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col">
                        <div className="font-medium text-slate-900 flex items-center gap-2">
                          {u.displayName}
                          {u.isOwner ? (
                            <Badge
                              variant="warning"
                              className="flex items-center gap-1"
                            >
                              <Crown className="h-3 w-3" />
                              Owner
                            </Badge>
                          ) : null}
                          {isSelf && !u.isOwner ? (
                            <Badge variant="secondary">You</Badge>
                          ) : null}
                        </div>
                        <div className="text-xs text-slate-500 font-mono">
                          {u.email}
                        </div>
                        {u.title ? (
                          <div className="text-xs text-slate-600 italic">
                            {u.title}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={u.roleKey}
                      onChange={(e) => changeRole(u, e.target.value)}
                      disabled={
                        busyId === u.id || protectedRow || u.disabled
                      }
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {roles.map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.displayName}
                          {r.isBuiltIn ? " (built-in)" : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    {u.disabled ? (
                      <Badge variant="danger">Disabled</Badge>
                    ) : (
                      <Badge variant="success">Active</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {busyId === u.id ? (
                      <Loader2 className="h-4 w-4 animate-spin inline" />
                    ) : protectedRow ? (
                      <span className="text-xs text-slate-500">—</span>
                    ) : isSelf ? (
                      <span className="text-xs text-slate-500">
                        (cannot disable self)
                      </span>
                    ) : u.disabled ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleDisabled(u, false)}
                      >
                        <ShieldCheck className="h-4 w-4" />
                        Re-enable
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleDisabled(u, true)}
                      >
                        <ShieldOff className="h-4 w-4" />
                        Disable
                      </Button>
                    )}
                    {rowError ? (
                      <div className="mt-1 text-xs text-rose-700">
                        {rowError}
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-6 text-center text-sm text-slate-500"
                >
                  No users match the filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
