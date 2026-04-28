import { LogOut } from "lucide-react";
import { signOut } from "@/auth";
import { requireUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/" });
}

export async function Topbar({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  // Server Components are NOT in the proxy chain (Next 16); enforce auth
  // here too so a refactor that drops the proxy can't expose data.
  const user = await requireUser();

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
          <div className="text-right">
            <div className="text-sm font-medium text-slate-900">
              {user.displayName}
            </div>
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
