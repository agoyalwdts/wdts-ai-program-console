import { cn } from "@/lib/utils";

function Shimmer({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-slate-200/80", className)} />;
}

export function DashboardLoading() {
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2 flex-1">
            <Shimmer className="h-7 w-48 max-w-[60%]" />
            <Shimmer className="h-4 w-96 max-w-[85%]" />
          </div>
          <div className="hidden sm:flex items-center gap-3 shrink-0">
            <div className="space-y-1.5 text-right">
              <Shimmer className="h-4 w-28 ml-auto" />
              <Shimmer className="h-3 w-36 ml-auto" />
            </div>
            <Shimmer className="h-8 w-24" />
          </div>
        </div>
      </div>
      <div className="p-6 space-y-6 flex-1">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
              <Shimmer className="h-3 w-24" />
              <Shimmer className="h-8 w-16" />
              <Shimmer className="h-3 w-32" />
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
          <Shimmer className="h-6 w-40" />
          <Shimmer className="h-4 w-full max-w-lg" />
          <Shimmer className="h-48 w-full" />
        </div>
      </div>
    </div>
  );
}
