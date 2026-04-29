"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, AlertCircle } from "lucide-react";
import type { PermissionMeta } from "@/lib/rbac/permissions";

export function CreateRoleForm({
  catalog,
}: {
  catalog: PermissionMeta[];
}) {
  const router = useRouter();
  const [key, setKey] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function toggle(k: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: key.trim(),
          displayName: displayName.trim(),
          description: description.trim() || undefined,
          permissions: [...picked],
        }),
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
      setBusy(false);
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
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-900">
          Slug (key)
        </label>
        <Input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="auditor"
          required
          pattern="[a-z0-9][a-z0-9_-]{1,40}"
          title="lowercase letters, digits, _ or -, 2-41 chars"
        />
        <div className="text-xs text-slate-500">
          Permanent. Lowercase, kebab/snake case. Used in audit logs and
          permission checks.
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-900">
          Display name
        </label>
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Auditor"
          required
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-900">
          Description (optional)
        </label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Read-only access to spend + decisions for compliance review."
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-slate-900">
            Permissions ({picked.size} selected)
          </label>
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
                    className="flex items-start gap-2 py-1 cursor-pointer hover:bg-white rounded px-1"
                  >
                    <input
                      type="checkbox"
                      checked={picked.has(p.key)}
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

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating…
            </>
          ) : (
            "Create role"
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/settings/roles")}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
