import { ShieldAlert } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";

export function Topbar({ title, subtitle }: { title: string; subtitle?: string }) {
  const user = getCurrentUser();
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          {subtitle ? (
            <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
            <ShieldAlert className="h-3.5 w-3.5" />
            DEV AUTH STUB
          </span>
          <div className="text-right">
            <div className="text-sm font-medium text-slate-900">{user.displayName}</div>
            <div className="text-xs text-slate-500">{user.email} · {user.role}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
