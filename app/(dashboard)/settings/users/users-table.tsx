"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  CheckCircle2,
  Crown,
  Loader2,
  ShieldCheck,
  ShieldOff,
  UserPlus,
  X,
} from "lucide-react";

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
  const router = useRouter();
  const [filter, setFilter] = React.useState("");
  const [rows, setRows] = React.useState<UserRow[]>([...users]);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<{ id: string; msg: string } | null>(
    null,
  );
  const [inviteOpen, setInviteOpen] = React.useState(false);

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

  function handleInvited(u: UserRow) {
    setRows((rs) => [u, ...rs]);
    setInviteOpen(false);
    // Refresh the server component so any joins (counts, etc.) re-render.
    router.refresh();
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
        <div className="flex items-center gap-3">
          <div className="text-xs text-slate-500">
            Showing {filtered.length} / {rows.length}
          </div>
          <Button onClick={() => setInviteOpen((o) => !o)} size="sm">
            {inviteOpen ? (
              <>
                <X className="h-4 w-4" />
                Close
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" />
                Invite user
              </>
            )}
          </Button>
        </div>
      </div>

      {inviteOpen ? (
        <InvitePanel
          roles={roles}
          onCancel={() => setInviteOpen(false)}
          onInvited={handleInvited}
        />
      ) : null}

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

function InvitePanel({
  roles,
  onCancel,
  onInvited,
}: {
  roles: ReadonlyArray<RoleOption>;
  onCancel: () => void;
  onInvited: (u: UserRow) => void;
}) {
  const [email, setEmail] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [roleKey, setRoleKey] = React.useState("USER");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [okMsg, setOkMsg] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          displayName: displayName.trim() || undefined,
          title: title.trim() || undefined,
          roleKey,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        user?: {
          id: string;
          email: string;
          displayName: string;
          roleKey: string;
        };
      };
      if (!res.ok || !json.ok || !json.user) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setOkMsg(
        `Invited ${json.user.email}. They&apos;ll appear here as Active once they sign in.`,
      );
      onInvited({
        id: json.user.id,
        email: json.user.email,
        displayName: json.user.displayName,
        title: title.trim() || null,
        roleTag: "UNKNOWN",
        region: "UNKNOWN",
        status: "ACTIVE",
        disabled: false,
        isOwner: false,
        roleKey: json.user.roleKey,
        createdAt: new Date().toISOString(),
      });
      setEmail("");
      setDisplayName("");
      setTitle("");
      setRoleKey("USER");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-md border border-sky-200 bg-sky-50/40 p-4 space-y-3"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-sky-100 p-1.5">
          <UserPlus className="h-4 w-4 text-sky-700" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium text-slate-900">
            Invite a user
          </div>
          <div className="text-xs text-slate-600">
            They&apos;ll be able to sign in immediately. No email is sent — pass
            them the dashboard URL out of band.
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-700">
            Work email <span className="text-rose-600">*</span>
          </label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="firstname.lastname@wdtablesystems.com"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-700">Role</label>
          <select
            value={roleKey}
            onChange={(e) => setRoleKey(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            {roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.displayName}
                {r.isBuiltIn ? " (built-in)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-700">
            Display name (optional)
          </label>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Auto-filled from Microsoft profile on first sign-in"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-700">
            Title (optional)
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Head of FinOps"
          />
        </div>
      </div>
      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
      {okMsg ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800 flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{okMsg}</span>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Inviting…
            </>
          ) : (
            "Send invite"
          )}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
