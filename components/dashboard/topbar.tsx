"use client";

import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/components/dashboard/sign-out-action";
import { useSessionUser } from "@/components/dashboard/user-session-provider";

export function Topbar({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  const user = useSessionUser();

  return (
    <header className="border-b border-slate-200 bg-white shrink-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-slate-900 truncate">{title}</h1>
          {subtitle ? (
            <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-4">
          <div className="text-right hidden sm:block">
            <div className="text-sm font-medium text-slate-900">{user.displayName}</div>
            <div className="text-xs text-slate-500">
              {user.email} · {user.role}
            </div>
          </div>
          <form action={signOutAction}>
            <Button type="submit" variant="outline" size="sm">
              <LogOut className="h-3.5 w-3.5 mr-1.5" />
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
