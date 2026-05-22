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
  userEmailNotifiedAt: string | null;
  /** Dashboard User.disabled for alert.userEmail, if a row exists. */
  subjectDisabled: boolean | null;
  subjectHasUserRow: boolean;
};

type PendingAction =
  | "ack"
  | "email"
  | "disable"
  | "seat-removal"
  | null;

export function GuardrailsAlertsTable({
  initial,
  canManageUsers,
}: {
  initial: GuardrailAlertRow[];
  canManageUsers: boolean;
}) {
  const [rows, setRows] = React.useState(initial);
  const [pending, setPending] = React.useState<{ id: string; action: PendingAction } | null>(null);
  const [rowError, setRowError] = React.useState<Record<string, string>>({});
  const [seatRemovalLogged, setSeatRemovalLogged] = React.useState<Record<string, string>>({});

  async function runAction(
    id: string,
    action: PendingAction,
    path: string,
    init?: RequestInit,
  ): Promise<Record<string, unknown> | null> {
    setPending({ id, action });
    setRowError((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const res = await fetch(path, init);
      const j = (await res.json()) as Record<string, unknown>;
      if (!res.ok || j.ok === false) {
        setRowError((prev) => ({
          ...prev,
          [id]: String(j.error ?? `Request failed (${res.status})`),
        }));
        return null;
      }
      return j;
    } finally {
      setPending(null);
    }
  }

  async function ack(id: string) {
    const j = await runAction(id, "ack", `/api/guardrail-policy-alerts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acknowledged: true }),
    });
    if (!j) return;
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              acknowledgedAt:
                (j.acknowledgedAt as string | undefined) ??
                r.acknowledgedAt ??
                new Date().toISOString(),
            }
          : r,
      ),
    );
  }

  async function sendEmail(r: GuardrailAlertRow) {
    const msg = r.userEmailNotifiedAt
      ? `Coaching email was already sent (${new Date(r.userEmailNotifiedAt).toLocaleString()}). Send again?`
      : `Send a coaching email to ${r.userEmail}?`;
    if (!confirm(msg)) return;

    const j = await runAction(
      r.id,
      "email",
      `/api/guardrail-policy-alerts/${r.id}/send-coaching-email`,
      { method: "POST" },
    );
    if (!j) return;
    if (j.skipped) {
      setRowError((prev) => ({
        ...prev,
        [r.id]: String(j.reason ?? "Email skipped (check RESEND_API_KEY)."),
      }));
      return;
    }
    setRows((prev) =>
      prev.map((row) =>
        row.id === r.id
          ? {
              ...row,
              userEmailNotifiedAt:
                (j.userEmailNotifiedAt as string | undefined) ?? new Date().toISOString(),
            }
          : row,
      ),
    );
  }

  async function disableUser(r: GuardrailAlertRow) {
    if (
      !confirm(
        `Disable dashboard sign-in for ${r.userEmail}?\n\nThis blocks access to this console only — it does not revoke Cursor, ChatGPT, or other vendor seats.`,
      )
    ) {
      return;
    }
    const j = await runAction(
      r.id,
      "disable",
      `/api/guardrail-policy-alerts/${r.id}/disable-user`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    );
    if (!j) return;
    setRows((prev) =>
      prev.map((row) => (row.id === r.id ? { ...row, subjectDisabled: true } : row)),
    );
  }

  async function requestSeatRemoval(r: GuardrailAlertRow) {
    const product = r.product ?? "program";
    if (
      !confirm(
        `Log a ${product} seat-removal request for ${r.userEmail}?\n\nThis writes a Decision row for FinOps follow-up. No vendor API is called from the dashboard.`,
      )
    ) {
      return;
    }
    const j = await runAction(
      r.id,
      "seat-removal",
      `/api/guardrail-policy-alerts/${r.id}/request-seat-removal`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    );
    if (!j) return;
    setSeatRemovalLogged((prev) => ({
      ...prev,
      [r.id]: String(j.decisionId ?? "logged"),
    }));
  }

  function isPending(id: string, action: PendingAction) {
    return pending?.id === id && pending.action === action;
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
          <TH className="pr-3 min-w-[200px]">Actions</TH>
        </TR>
      </THead>
      <TBody>
        {rows.length === 0 ? (
          <TR>
            <TD colSpan={7} className="pl-3 pr-3 py-8 text-center text-slate-500 text-sm">
              No guardrail alerts yet. Run the monitor or wait for the hourly cron.
            </TD>
          </TR>
        ) : (
          rows.map((r) => {
            const dim = Boolean(r.acknowledgedAt);
            const canEmail = Boolean(r.userEmail) && r.subjectHasUserRow && !r.subjectDisabled;
            const canDisable =
              canManageUsers && Boolean(r.userEmail) && r.subjectHasUserRow && !r.subjectDisabled;
            const canSeatRemoval = Boolean(r.userEmail);
            const removalId = seatRemovalLogged[r.id];

            return (
              <TR key={r.id} className={dim ? "opacity-70" : ""}>
                <TD className="pl-3 text-xs whitespace-nowrap">
                  {new Date(r.occurredAt).toLocaleString()}
                </TD>
                <TD className="text-xs">{r.category}</TD>
                <TD>
                  <Badge
                    variant={
                      r.severity === "HIGH"
                        ? "danger"
                        : r.severity === "MEDIUM"
                          ? "warning"
                          : "secondary"
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
                <TD
                  className="text-xs max-w-[240px]"
                  title={`${r.title}\n${r.rationale}\n${r.recommendation ?? ""}`}
                >
                  <div className="font-medium text-slate-800">{r.title}</div>
                  <div className="text-slate-500 line-clamp-2">{r.ruleCode}</div>
                </TD>
                <TD className="pr-3 align-top">
                  <div className="flex flex-col items-end gap-1.5">
                    <div className="flex flex-wrap justify-end gap-1">
                      {r.acknowledgedAt ? (
                        <Badge variant="secondary" className="text-[10px]">
                          Ack
                        </Badge>
                      ) : null}
                      {r.userEmailNotifiedAt ? (
                        <Badge variant="secondary" className="text-[10px]">
                          Emailed
                        </Badge>
                      ) : null}
                      {r.subjectDisabled ? (
                        <Badge variant="warning" className="text-[10px]">
                          Console off
                        </Badge>
                      ) : null}
                      {removalId ? (
                        <Badge variant="secondary" className="text-[10px]" title={removalId}>
                          Removal logged
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-1 w-full max-w-[200px]">
                      {!r.acknowledgedAt ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs w-full"
                          disabled={pending !== null}
                          onClick={() => ack(r.id)}
                        >
                          {isPending(r.id, "ack") ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            "Acknowledge"
                          )}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs w-full"
                        disabled={!canEmail || pending !== null}
                        title={
                          !r.userEmail
                            ? "No user on alert"
                            : !r.subjectHasUserRow
                              ? "No User row — invite under Settings → Users"
                              : r.subjectDisabled
                                ? "User disabled on console"
                                : undefined
                        }
                        onClick={() => sendEmail(r)}
                      >
                        {isPending(r.id, "email") ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          "Email user"
                        )}
                      </Button>
                      {canManageUsers ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs w-full border-amber-300 text-amber-900 hover:bg-amber-50"
                          disabled={!canDisable || pending !== null}
                          title={
                            !r.userEmail
                              ? "No user on alert"
                              : !r.subjectHasUserRow
                                ? "No User row"
                                : r.subjectDisabled
                                  ? "Already disabled"
                                  : "Blocks dashboard sign-in only"
                          }
                          onClick={() => disableUser(r)}
                        >
                          {isPending(r.id, "disable") ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            "Block console"
                          )}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs w-full"
                        disabled={!canSeatRemoval || Boolean(removalId) || pending !== null}
                        title={
                          removalId
                            ? "Removal already logged this session"
                            : "Writes Decision — no vendor API call"
                        }
                        onClick={() => requestSeatRemoval(r)}
                      >
                        {isPending(r.id, "seat-removal") ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          "Request seat removal"
                        )}
                      </Button>
                    </div>
                    {rowError[r.id] ? (
                      <p className="text-[10px] text-red-600 text-right max-w-[200px]">{rowError[r.id]}</p>
                    ) : null}
                  </div>
                </TD>
              </TR>
            );
          })
        )}
      </TBody>
    </Table>
  );
}
