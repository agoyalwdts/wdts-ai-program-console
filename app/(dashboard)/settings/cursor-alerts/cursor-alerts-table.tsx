"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatUsd } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export type AlertRow = {
  id: string;
  rowOccurredAt: string;
  userEmail: string;
  model: string;
  maxMode: string;
  outputTokens: number;
  cacheRead: number;
  costUsd: number;
  ruleCode: string;
  title: string;
  rationale: string;
  acknowledgedAt: string | null;
};

export function CursorAlertsTable({ initial }: { initial: AlertRow[] }) {
  const [rows, setRows] = React.useState(initial);
  const [pending, setPending] = React.useState<string | null>(null);

  async function ack(id: string) {
    setPending(id);
    try {
      const res = await fetch(`/api/cursor-prudence-alerts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledged: true }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        acknowledgedAt?: string;
        alreadyAcknowledged?: boolean;
      };
      if (!res.ok || !j.ok) return;
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                acknowledgedAt:
                  j.acknowledgedAt ?? r.acknowledgedAt ?? new Date().toISOString(),
              }
            : r,
        ),
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <Table>
      <THead>
        <TR>
          <TH className="pl-3">When</TH>
          <TH>User</TH>
          <TH>Model</TH>
          <TH>Max</TH>
          <TH className="text-right">Out</TH>
          <TH className="text-right">Cache read</TH>
          <TH className="text-right">Cost</TH>
          <TH>Rule</TH>
          <TH className="pr-3">Action</TH>
        </TR>
      </THead>
      <TBody>
        {rows.length === 0 ? (
          <TR>
            <TD colSpan={9} className="pl-3 pr-3 py-8 text-center text-slate-500 text-sm">
              No alerts yet. Upload a Cursor team-usage CSV above.
            </TD>
          </TR>
        ) : (
          rows.map((r) => (
            <TR key={r.id} className={r.acknowledgedAt ? "opacity-60" : ""}>
              <TD className="pl-3 text-xs whitespace-nowrap">
                {new Date(r.rowOccurredAt).toLocaleString()}
              </TD>
              <TD className="text-xs font-mono max-w-[140px] truncate" title={r.userEmail}>
                {r.userEmail}
              </TD>
              <TD className="text-xs max-w-[200px]" title={r.model}>
                {r.model}
              </TD>
              <TD>
                <Badge variant={r.maxMode === "Yes" ? "warning" : "secondary"}>
                  {r.maxMode}
                </Badge>
              </TD>
              <TD className="text-right text-xs tabular-nums">
                {r.outputTokens.toLocaleString()}
              </TD>
              <TD className="text-right text-xs tabular-nums">
                {r.cacheRead.toLocaleString()}
              </TD>
              <TD className="text-right text-xs tabular-nums">
                {formatUsd(r.costUsd, { decimals: 2 })}
              </TD>
              <TD className="text-xs max-w-[160px]" title={`${r.title}\n${r.rationale}`}>
                <div className="font-medium text-slate-800">{r.title}</div>
                <div className="text-slate-500 line-clamp-2">{r.ruleCode}</div>
              </TD>
              <TD className="pr-3">
                {r.acknowledgedAt ? (
                  <span className="text-xs text-slate-500">Acknowledged</span>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending === r.id}
                    onClick={() => ack(r.id)}
                  >
                    {pending === r.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      "Acknowledge"
                    )}
                  </Button>
                )}
              </TD>
            </TR>
          ))
        )}
      </TBody>
    </Table>
  );
}
