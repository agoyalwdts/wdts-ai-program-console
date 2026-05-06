"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Layers,
  LayoutGrid,
  Receipt,
  ScrollText,
  Settings,
  UserCog,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/health", label: "Program Health", icon: Activity, feature: "F1" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, feature: "—" },
  { href: "/users", label: "Users", icon: Users, feature: "F2" },
  { href: "/managers", label: "Manager Queue", icon: UserCog, feature: "F3" },
  { href: "/cursor-seats", label: "Cursor Seats", icon: LayoutGrid, feature: "F4" },
  { href: "/decisions", label: "Decisions", icon: ScrollText, feature: "F5" },
  { href: "/codex-ladder", label: "Codex Ladder", icon: Layers, feature: "F9" },
  { href: "/chargeback", label: "Chargeback", icon: Receipt, feature: "F10" },
  { href: "/settings", label: "Settings", icon: Settings, feature: "stub" },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-60 shrink-0 border-r border-slate-200 bg-white">
      <div className="px-5 py-5 border-b border-slate-200">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          WDTS
        </div>
        <div className="mt-1 text-base font-semibold text-slate-900">
          AI Program Console
        </div>
        <div className="mt-1 text-[11px] text-slate-400">v0.1 prototype</div>
      </div>
      <nav className="p-3 flex flex-col gap-0.5">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-100",
              )}
            >
              <span className="inline-flex items-center gap-2">
                <Icon className="h-4 w-4" />
                {item.label}
              </span>
              <span
                className={cn(
                  "text-[10px] font-mono",
                  active ? "text-slate-300" : "text-slate-400",
                )}
              >
                {item.feature}
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
