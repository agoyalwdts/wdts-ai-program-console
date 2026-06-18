import { Suspense } from "react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { DashboardAuthShell } from "@/components/dashboard/dashboard-auth-shell";
import { DashboardLoading } from "@/components/dashboard/dashboard-loading";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <Suspense fallback={<DashboardLoading />}>
        <DashboardAuthShell>{children}</DashboardAuthShell>
      </Suspense>
    </div>
  );
}
