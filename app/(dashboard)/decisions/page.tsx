import Link from "next/link";
import { Topbar } from "@/components/dashboard/topbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TYPE_FILTERS = [
  "ALL",
  "TIER_PROMOTION",
  "TIER_DEMOTION",
  "RECLAMATION",
  "EXCEPTION_GRANT",
  "METHODOLOGY_CHANGE",
  "CAP_ADJUSTMENT",
  "CURSOR_SEAT_GRANT",
] as const;

const DATE_FILTERS: { key: string; label: string; days?: number }[] = [
  { key: "all", label: "All time" },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "60d", label: "Last 60 days", days: 60 },
  { key: "90d", label: "Last 90 days", days: 90 },
];

type SP = { type?: string; since?: string };

export default async function DecisionsPage(props: { searchParams: Promise<SP> }) {
  const sp = await props.searchParams;
  const type = (sp.type as (typeof TYPE_FILTERS)[number]) ?? "ALL";
  const since = sp.since ?? "all";

  const now = new Date();
  const sinceDate =
    since === "all"
      ? undefined
      : new Date(now.getTime() - (DATE_FILTERS.find((d) => d.key === since)?.days ?? 9999) * 24 * 60 * 60 * 1000);

  const decisions = await prisma.decision.findMany({
    where: {
      ...(type !== "ALL" ? { type } : {}),
      ...(sinceDate ? { ts: { gte: sinceDate } } : {}),
    },
    orderBy: { ts: "desc" },
    include: { subject: { select: { email: true, displayName: true } } },
  });

  const exportHref = `/api/decisions/export?type=${type}${sinceDate ? `&since=${sinceDate.toISOString()}` : ""}`;

  return (
    <>
      <Topbar
        title="Decision Log"
        subtitle="F5 — append-only ledger of program decisions. Filterable; CSV export for SOC 2 / customer security review."
      />
      <div className="p-6 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <CardTitle>Filters</CardTitle>
                <CardDescription>Click a chip to apply.</CardDescription>
              </div>
              <Button asChild variant="default">
                <a href={exportHref}>
                  <Download className="h-4 w-4" />
                  Export CSV
                </a>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Type</div>
              <div className="flex flex-wrap gap-1.5">
                {TYPE_FILTERS.map((t) => {
                  const active = type === t;
                  const href = `/decisions?type=${t}${since !== "all" ? `&since=${since}` : ""}`;
                  return (
                    <Link
                      key={t}
                      href={href}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        active
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
                      )}
                    >
                      {t.replace(/_/g, " ")}
                    </Link>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Date range</div>
              <div className="flex flex-wrap gap-1.5">
                {DATE_FILTERS.map((d) => {
                  const active = since === d.key;
                  const href = `/decisions?type=${type}&since=${d.key}`;
                  return (
                    <Link
                      key={d.key}
                      href={href}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        active
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
                      )}
                    >
                      {d.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Decisions</CardTitle>
            <CardDescription>
              {decisions.length} record{decisions.length === 1 ? "" : "s"} matching the
              current filters.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <THead>
                <TR>
                  <TH className="pl-5">When</TH>
                  <TH>Type</TH>
                  <TH>Subject</TH>
                  <TH>Actor</TH>
                  <TH>Justification</TH>
                  <TH className="pr-5">Evidence</TH>
                </TR>
              </THead>
              <TBody>
                {decisions.map((d) => (
                  <TR key={d.id}>
                    <TD className="pl-5 text-slate-600 font-mono text-xs whitespace-nowrap">
                      {d.ts.toISOString().slice(0, 10)}
                    </TD>
                    <TD>
                      <Badge variant={badgeVariant(d.type)}>{d.type}</Badge>
                    </TD>
                    <TD className="text-slate-700">
                      {d.subject ? (
                        <Link
                          href={`/users?user=${d.subjectUserId}`}
                          className="hover:underline"
                        >
                          {d.subject.displayName}
                        </Link>
                      ) : (
                        <span className="text-slate-400 italic">program-level</span>
                      )}
                    </TD>
                    <TD className="text-slate-600 text-xs font-mono">{d.actorEmail}</TD>
                    <TD className="text-slate-700 max-w-[42ch]">
                      <span title={d.justification} className="line-clamp-2">
                        {d.justification}
                      </span>
                    </TD>
                    <TD className="pr-5 text-xs">
                      {d.evidenceLink ? (
                        <a
                          href={d.evidenceLink}
                          className="text-sky-600 hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          link
                        </a>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </TD>
                  </TR>
                ))}
                {decisions.length === 0 ? (
                  <TR>
                    <TD className="px-5 py-6 text-sm text-slate-500" colSpan={6}>
                      No decisions matched the current filters.
                    </TD>
                  </TR>
                ) : null}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <p className="text-xs text-slate-400">
          v0.1 — append-only is enforced by convention; v1.1 will add row-level immutability
          and nightly export to a WORM Azure Blob (scoping §3.3).
        </p>
      </div>
    </>
  );
}

function badgeVariant(t: string) {
  switch (t) {
    case "TIER_PROMOTION":
    case "CURSOR_SEAT_GRANT":
      return "success" as const;
    case "TIER_DEMOTION":
    case "RECLAMATION":
    case "CURSOR_SEAT_RECLAIM":
      return "danger" as const;
    case "EXCEPTION_GRANT":
      return "warning" as const;
    case "METHODOLOGY_CHANGE":
    case "CAP_ADJUSTMENT":
      return "violet" as const;
    default:
      return "secondary" as const;
  }
}
