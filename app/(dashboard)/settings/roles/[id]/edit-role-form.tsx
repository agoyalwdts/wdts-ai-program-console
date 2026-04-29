"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertCircle, CheckCircle2, Loader2, Trash2 } from "lucide-react";
import type { PermissionMeta } from "@/lib/rbac/permissions";

export function EditRoleForm({
  roleId,
  roleKey,
  isBuiltIn,
  userCount,
  initial,
  catalog,
}: {
  roleId: string;
  roleKey: string;
  isBuiltIn: boolean;
  userCount: number;
  initial: {
    displayName: string;
    description: string;
    permissions: ReadonlyArray<string>;
  };
  catalog: PermissionMeta[];
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = React.useState(initial.displayName);
  const [description, setDescription] = React.useState(initial.description);
  const [picked, setPicked] = React.useState<Set<string>>(
    new Set(initial.permissions),
  );
  const [busy, setBusy] = React.useState<"save" | "delete" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [okMsg, setOkMsg] = React.useState<string | null>(null);

  function toggle(k: string) {
    if (isBuiltIn) return;
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    setError(null);
    setOkMsg(null);
    try {
      const body: {
        displayName?: string;
        description?: string | null;
        permissions?: string[];
      } = {
        displayName: displayName.trim(),
        description: description.trim() || null,
      };
      if (!isBuiltIn) {
        body.permissions = [...picked];
      }
      const res = await fetch(`/api/admin/roles/${roleId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setOkMsg("Saved.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function deleteRole() {
    if (
      !confirm(
        `Delete custom role "${displayName}"? This cannot be undone. (No users currently have this role.)`,
      )
    )
      return;
    setBusy("delete");
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`/api/admin/roles/${roleId}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      router.push("/settings/roles");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const grouped = React.useMemo(() => {
    const cats = ["Dashboard", "Operations", "Admin", "Future write paths"] as const;
    return cats.map((c) => ({
      cat: c,
      items: catalog.filter((p) => p.category === c),
    }));
  }, [catalog]);

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-900">Slug (key)</label>
        <Input value={roleKey} readOnly disabled className="bg-slate-50" />
        <div className="text-xs text-slate-500">
          Permanent. Cannot be changed after creation.
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-900">
          Display name
        </label>
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-900">
          Description
        </label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-slate-900">
            Permissions ({picked.size} granted)
          </label>
          {isBuiltIn ? (
            <div className="text-xs text-amber-700">
              Built-in role — permissions are read-only here. Edit{" "}
              <code className="font-mono">lib/rbac/built-in-roles.ts</code> in
              code to change.
            </div>
          ) : (
            <div className="text-xs text-slate-500">
              <button
                type="button"
                className="text-sky-700 hover:underline mr-3"
                onClick={() => setPicked(new Set(catalog.map((p) => p.key)))}
              >
                Select all
              </button>
              <button
                type="button"
                className="text-sky-700 hover:underline"
                onClick={() => setPicked(new Set())}
              >
                Clear
              </button>
            </div>
          )}
        </div>
        <div className="rounded-md border border-slate-200 divide-y divide-slate-100 max-h-96 overflow-y-auto">
          {grouped.map(({ cat, items }) =>
            items.length === 0 ? null : (
              <div key={cat} className="bg-slate-50/40 px-3 py-2">
                <div className="text-xs font-medium text-slate-700 uppercase tracking-wide">
                  {cat}
                </div>
                {items.map((p) => (
                  <label
                    key={p.key}
                    className={`flex items-start gap-2 py-1 px-1 rounded ${
                      isBuiltIn
                        ? "cursor-default opacity-90"
                        : "cursor-pointer hover:bg-white"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={picked.has(p.key)}
                      disabled={isBuiltIn}
                      onChange={() => toggle(p.key)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-900">
                        {p.displayName}
                      </div>
                      <div className="text-xs text-slate-500 font-mono break-all">
                        {p.key}
                      </div>
                      <div className="text-xs text-slate-600">
                        {p.description}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            ),
          )}
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <pre className="whitespace-pre-wrap break-words text-xs flex-1">
            {error}
          </pre>
        </div>
      ) : null}
      {okMsg ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          {okMsg}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy !== null}>
          {busy === "save" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            "Save"
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/settings/roles")}
          disabled={busy !== null}
        >
          Cancel
        </Button>
        {!isBuiltIn ? (
          <div className="ml-auto">
            <Button
              type="button"
              variant="outline"
              onClick={deleteRole}
              disabled={busy !== null || userCount > 0}
              title={
                userCount > 0
                  ? `Reassign the ${userCount} user(s) on this role first.`
                  : undefined
              }
              className="border-rose-300 text-rose-700 hover:bg-rose-50"
            >
              {busy === "delete" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete role
            </Button>
          </div>
        ) : null}
      </div>
    </form>
  );
}
