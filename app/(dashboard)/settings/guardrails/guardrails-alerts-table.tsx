"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Loader2 } from "lucide-react";

export type GuardrailAlertRow = {
  id: string;
  occurredAt: string;
  category: string;
  severity: string;
  product: string | null;
  userEmail: string | null;
  model: string | null;
  ruleCode: string;
  title: string;
  rationale: string;
  recommendation: string | null;
  acknowledgedAt: string | null;
};

export function GuardrailsAlertsTable({ initial }: { initial: GuardrailAlertRow[] }) {
  const [rows, setRows] = React.useState(initial);
  const [pending, setPending] = React.useState<string | null>(null);

  async function ack(id: string) {
    setPending(id);
    try {
      const res = await fetch(`/api/guardrail-policy-alerts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledged: true }),
      });
      const j = (await res.json()) as { ok?: boolean; acknowledgedAt?: string };
      if (!res.ok || !j.ok) return;
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, acknowledgedAt: j.acknowledgedAt ?? r.acknowledgedAt ?? new Date().toISOString() }
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
          <TH>Category</TH>
          <TH>Severity</TH>
          <TH>User</TH>
          <TH>Model/Product</TH>
          <TH>Rule</TH>
          <TH className="pr-3">Action</TH>
        </TR>
      </THead>
      <TBody>
        {rows.length === 0 ? (
          <TR>
            <TD colSpan={7} className="pl-3 pr-3 py-8 text-center text-slate-500 text-sm">
              No guardrail alerts in the current window.
            </TD>
          </TR>
        ) : (
          rows.map((r) => (
            <TR key={r.id} className={r.acknowledgedAt ? "opacity-60" : ""}>
              <TD className="pl-3 text-xs whitespace-nowrap">{new Date(r.occurredAt).toLocaleString()}</TD>
              <TD className="text-xs">{r.category}</TD>
              <TD>
                <Badge
                  variant={
                    r.severity === "HIGH" ? "danger" : r.severity === "MEDIUM" ? "warning" : "secondary"
                  }
                >
                  {r.severity}
                </Badge>
              </TD>
              <TD className="text-xs font-mono max-w-[160px] truncate" title={r.userEmail ?? "—"}>
                {r.userEmail ?? "—"}
              </TD>
              <TD className="text-xs max-w-[220px]" title={`${r.model ?? "—"} / ${r.product ?? "—"}`}>
                <div>{r.model ?? "—"}</div>
                <div className="text-slate-500">{r.product ?? "—"}</div>
              </TD>
              <TD className="text-xs max-w-[280px]" title={`${r.title}\n${r.rationale}\n${r.recommendation ?? ""}`}>
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
                    {pending === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Acknowledge"}
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
