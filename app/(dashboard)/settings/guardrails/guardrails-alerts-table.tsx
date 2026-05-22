"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ChevronDown, ChevronRight, Info, Loader2 } from "lucide-react";

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
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  function disabledActionTitle(r: GuardrailAlertRow, kind: "email" | "disable" | "seat") {
    if (!r.userEmail) return "No user on alert";
    if (kind !== "seat" && !r.subjectHasUserRow) return "No User row — invite under Settings → Users";
    if (kind !== "seat" && r.subjectDisabled) {
      return kind === "email" ? "User disabled on console" : "Already disabled";
    }
    if (kind === "disable") return "Blocks dashboard sign-in only";
    if (kind === "seat" && seatRemovalLogged[r.id]) return "Removal already logged this session";
    if (kind === "seat") return "Writes Decision — no vendor API call";
    return undefined;
  }

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

            const expanded = expandedId === r.id;
            const emailTitle = disabledActionTitle(r, "email");
            const disableTitle = disabledActionTitle(r, "disable");
            const seatTitle = disabledActionTitle(r, "seat");

            return (
              <React.Fragment key={r.id}>
              <TR className={dim ? "opacity-70" : ""}>
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
                <TD className="text-xs font-mono max-w-[160px]">
                  <span className="block truncate" title={r.userEmail ?? undefined}>
                    {r.userEmail ?? "—"}
                  </span>
                </TD>
                <TD className="text-xs max-w-[220px]">
                  <div className="truncate" title={r.model ?? undefined}>
                    {r.model ?? "—"}
                  </div>
                  <div className="text-slate-500">{r.product ?? "—"}</div>
                </TD>
                <TD className="text-xs max-w-[280px] align-top">
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      className="mt-0.5 shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      aria-expanded={expanded}
                      aria-label={expanded ? "Hide alert details" : "Show alert details"}
                      onClick={() => setExpandedId(expanded ? null : r.id)}
                    >
                      {expanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-800">{r.title}</div>
                      <div className="font-mono text-[10px] text-slate-500">{r.ruleCode}</div>
                      {!expanded ? (
                        <p className="mt-1 text-slate-600 line-clamp-2 leading-snug">{r.rationale}</p>
                      ) : null}
                      {r.recommendation && !expanded ? (
                        <p className="mt-0.5 text-sky-800 line-clamp-1 leading-snug">
                          Suggested: {r.recommendation}
                        </p>
                      ) : null}
                    </div>
                  </div>
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
                      <ActionButton
                        disabled={!canEmail || pending !== null}
                        disabledTitle={emailTitle}
                        onClick={() => sendEmail(r)}
                      >
                        {isPending(r.id, "email") ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          "Email user"
                        )}
                      </ActionButton>
                      {canManageUsers ? (
                        <ActionButton
                          disabled={!canDisable || pending !== null}
                          disabledTitle={disableTitle}
                          className="border-amber-300 text-amber-900 hover:bg-amber-50"
                          onClick={() => disableUser(r)}
                        >
                          {isPending(r.id, "disable") ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            "Block console"
                          )}
                        </ActionButton>
                      ) : null}
                      <ActionButton
                        disabled={!canSeatRemoval || Boolean(removalId) || pending !== null}
                        disabledTitle={seatTitle}
                        onClick={() => requestSeatRemoval(r)}
                      >
                        {isPending(r.id, "seat-removal") ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          "Request seat removal"
                        )}
                      </ActionButton>
                    </div>
                    {rowError[r.id] ? (
                      <p className="text-[10px] text-red-600 text-right max-w-[200px]">{rowError[r.id]}</p>
                    ) : null}
                  </div>
                </TD>
              </TR>
              {expanded ? (
                <TR className="bg-slate-50/80">
                  <TD colSpan={7} className="px-4 py-3 text-xs text-slate-700">
                    <div className="flex gap-2">
                      <Info className="h-4 w-4 shrink-0 text-sky-600 mt-0.5" />
                      <div className="space-y-2 min-w-0">
                        <div>
                          <span className="font-medium text-slate-900">Rationale</span>
                          <p className="mt-0.5 whitespace-pre-wrap break-words">{r.rationale}</p>
                        </div>
                        {r.recommendation ? (
                          <div>
                            <span className="font-medium text-slate-900">Suggested action</span>
                            <p className="mt-0.5 whitespace-pre-wrap break-words text-sky-900">
                              {r.recommendation}
                            </p>
                          </div>
                        ) : null}
                        <p className="text-[10px] text-slate-500 font-mono">Alert id: {r.id}</p>
                      </div>
                    </div>
                  </TD>
                </TR>
              ) : null}
              </React.Fragment>
            );
          })
        )}
      </TBody>
    </Table>
  );
}

/** Disabled buttons suppress native `title` tooltips — wrap so hover still explains why. */
function ActionButton({
  children,
  disabled,
  disabledTitle,
  className,
  onClick,
}: {
  children: React.ReactNode;
  disabled: boolean;
  disabledTitle?: string;
  className?: string;
  onClick: () => void;
}) {
  const wrapTitle = disabled && disabledTitle ? disabledTitle : undefined;
  return (
    <span className="block w-full" title={wrapTitle}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={`h-7 text-xs w-full ${className ?? ""}`}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </Button>
    </span>
  );
}
