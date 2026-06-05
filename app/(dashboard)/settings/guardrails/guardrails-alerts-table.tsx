"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { guardrailCategoryLabel } from "@/lib/guardrails/categories";
import { ChevronDown, ChevronRight, Info, Loader2 } from "lucide-react";

export type GuardrailAlertRow = {
  id: string;
  occurredAt: string;
  category: string;
  severity: string;
  product: string | null;
  userEmail: string | null;
  /** Email or `codex user …` when analytics has user_id only. */
  subjectLabel: string;
  subjectTitle?: string;
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
  /** Invited user (has role) who is currently console-blocked — Allow console is valid. */
  subjectCanReenable: boolean;
};

type PendingAction =
  | "ack"
  | "email"
  | "disable"
  | "enable"
  | "seat-removal"
  | null;

export type GuardrailProductCount = { value: string; count: number };

export function GuardrailsAlertsTable({
  initial,
  productFilter,
  productCounts,
  alertTotal,
  canManageUsers,
  coachingEmailConfigured,
  emailProvider,
}: {
  initial: GuardrailAlertRow[];
  /** Server-driven filter (`ALL`, `CODEX`, `OTHER`, …). */
  productFilter: string;
  productCounts: GuardrailProductCount[];
  /** Total alerts in DB for the active product filter. */
  alertTotal: number;
  canManageUsers: boolean;
  /** False when mail is not configured for the active EMAIL_PROVIDER. */
  coachingEmailConfigured: boolean;
  emailProvider: "graph" | "resend";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [rows, setRows] = React.useState(initial);
  const [pending, setPending] = React.useState<{ id: string; action: PendingAction } | null>(null);
  const [rowError, setRowError] = React.useState<Record<string, string>>({});
  const [seatRemovalLogged, setSeatRemovalLogged] = React.useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [userFilter, setUserFilter] = React.useState<string>("");
  const [sortBy, setSortBy] = React.useState<"when" | "product" | "user">("when");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");

  function onProductFilterChange(value: string) {
    const params = new URLSearchParams();
    if (value !== "ALL") params.set("product", value);
    const q = params.toString();
    router.push(q ? `${pathname}?${q}` : pathname);
  }

  const visible = React.useMemo(() => {
    const q = userFilter.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      const userOk =
        q.length === 0 ||
        (r.userEmail ?? "").toLowerCase().includes(q) ||
        r.subjectLabel.toLowerCase().includes(q) ||
        (r.title ?? "").toLowerCase().includes(q);
      return userOk;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "product") {
        return (a.product ?? "OTHER").localeCompare(b.product ?? "OTHER");
      }
      if (sortBy === "user") {
        return a.subjectLabel.localeCompare(b.subjectLabel);
      }
      return new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
    });

    return sortDir === "asc" ? sorted : sorted.reverse();
  }, [rows, userFilter, sortBy, sortDir]);

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
        [r.id]: String(j.reason ?? "Email skipped (check mail configuration)."),
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

  async function setConsoleAccess(r: GuardrailAlertRow, disabled: boolean) {
    const verb = disabled ? "Block" : "Allow";
    if (
      !confirm(
        `${verb} dashboard sign-in for ${r.userEmail}?\n\nThis only affects access to this console — it does not revoke Cursor, ChatGPT, or other vendor seats.`,
      )
    ) {
      return;
    }
    const j = await runAction(
      r.id,
      disabled ? "disable" : "enable",
      `/api/guardrail-policy-alerts/${r.id}/disable-user`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled }),
      },
    );
    if (!j) return;
    setRows((prev) =>
      prev.map((row) =>
        row.id === r.id
          ? {
              ...row,
              subjectDisabled: disabled,
              subjectHasUserRow: true,
            }
          : row,
      ),
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

  function isRowPending(id: string) {
    return pending?.id === id;
  }

  async function onActionSelect(r: GuardrailAlertRow, value: string) {
    if (!value) return;
    switch (value) {
      case "ack":
        await ack(r.id);
        break;
      case "email":
        await sendEmail(r);
        break;
      case "disable":
        await setConsoleAccess(r, true);
        break;
      case "enable":
        await setConsoleAccess(r, false);
        break;
      case "seat-removal":
        await requestSeatRemoval(r);
        break;
      default:
        break;
    }
  }

  function onSortHeaderClick(column: "when" | "product" | "user") {
    setSortBy((prev) => {
      if (prev === column) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir(column === "when" ? "desc" : "asc");
      return column;
    });
  }

  function sortMarker(column: "when" | "product" | "user") {
    if (sortBy !== column) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  }

  const selectClass =
    "h-8 w-full min-w-[9.5rem] rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50";

  const loadedCapNote =
    productFilter === "ALL" && alertTotal > rows.length
      ? ` (latest ${rows.length} of ${alertTotal.toLocaleString()} — pick a product to load that slice)`
      : alertTotal > rows.length
        ? ` (showing latest ${rows.length} of ${alertTotal.toLocaleString()})`
        : "";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 px-3 text-sm text-slate-600">
        <label className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Product</span>
          <select
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900"
            value={productFilter}
            onChange={(e) => onProductFilterChange(e.target.value)}
          >
            <option value="ALL">
              All products
              {productCounts.length > 0
                ? ` (${productCounts.reduce((n, p) => n + p.count, 0).toLocaleString()})`
                : ""}
            </option>
            {productCounts.map((p) => (
              <option key={p.value} value={p.value}>
                {p.value} ({p.count.toLocaleString()})
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500">User/email</span>
          <input
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            placeholder="Filter user/email…"
          />
        </label>
        <span className="text-xs text-slate-500">
          Showing {visible.length} of {rows.length} loaded
          {alertTotal !== rows.length ? ` · ${alertTotal.toLocaleString()} in DB` : ""} alert(s)
          {loadedCapNote}
        </span>
      </div>
    <Table className="min-w-[1080px] table-fixed">
      <colgroup>
        <col className="w-[10%]" />
        <col className="w-[12%]" />
        <col className="w-[8%]" />
        <col className="w-[14%]" />
        <col className="w-[10%]" />
        <col className="w-[8%]" />
        <col className="w-[26%]" />
        <col className="w-[12%]" />
      </colgroup>
      <THead>
        <TR>
          <TH className="pl-3">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-left"
              onClick={() => onSortHeaderClick("when")}
              aria-label="Sort by when"
            >
              <span>When</span>
              <span className="text-[10px] text-slate-500">{sortMarker("when")}</span>
            </button>
          </TH>
          <TH>Category</TH>
          <TH>Severity</TH>
          <TH>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-left"
              onClick={() => onSortHeaderClick("user")}
              aria-label="Sort by user"
            >
              <span>User</span>
              <span className="text-[10px] text-slate-500">{sortMarker("user")}</span>
            </button>
          </TH>
          <TH>Model</TH>
          <TH>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-left"
              onClick={() => onSortHeaderClick("product")}
              aria-label="Sort by product"
            >
              <span>Product</span>
              <span className="text-[10px] text-slate-500">{sortMarker("product")}</span>
            </button>
          </TH>
          <TH>Rule</TH>
          <TH className="pr-3">Actions</TH>
        </TR>
      </THead>
      <TBody>
        {visible.length === 0 ? (
          <TR>
            <TD colSpan={8} className="pl-3 pr-3 py-8 text-center text-slate-500 text-sm">
              {rows.length === 0
                ? productFilter === "ALL"
                  ? "No guardrail alerts yet. Run the monitor or wait for the hourly cron."
                  : `No ${productFilter} alerts in the database. Run the monitor with a 24h window — Codex needs INTEGRATION_CODEX_ENTERPRISE_ANALYTICS=real.`
                : "No rows match the user/email filter."}
            </TD>
          </TR>
        ) : (
          visible.map((r) => {
            const dim = Boolean(r.acknowledgedAt);
            const canEmail = Boolean(r.userEmail);
            const canDisable = canManageUsers && Boolean(r.userEmail) && !r.subjectDisabled;
            const canEnable = canManageUsers && Boolean(r.userEmail) && r.subjectCanReenable;
            const canSeatRemoval = Boolean(r.userEmail);
            const removalId = seatRemovalLogged[r.id];

            const expanded = expandedId === r.id;

            return (
              <React.Fragment key={r.id}>
              <TR className={dim ? "opacity-70" : ""}>
                <TD className="pl-3 text-xs whitespace-nowrap align-top py-2">
                  {new Date(r.occurredAt).toLocaleString()}
                </TD>
                <TD className="text-xs align-top py-2 break-words" title={r.category}>
                  {guardrailCategoryLabel(r.category, r.ruleCode)}
                </TD>
                <TD className="align-top py-2">
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
                <TD className="text-xs font-mono align-top py-2">
                  {r.userEmail ? (
                    <Link
                      href={`/users?user=${encodeURIComponent(r.userEmail)}#codex-usage`}
                      className="block break-all leading-snug text-sky-700 hover:underline"
                      title={r.subjectTitle ?? r.userEmail}
                    >
                      {r.subjectLabel}
                    </Link>
                  ) : (
                    <span
                      className="block break-all leading-snug text-amber-800"
                      title={r.subjectTitle ?? undefined}
                    >
                      {r.subjectLabel}
                    </span>
                  )}
                </TD>
                <TD className="text-xs align-top py-2">
                  <div className="break-words leading-snug font-mono" title={r.model ?? undefined}>
                    {r.model ?? "—"}
                  </div>
                </TD>
                <TD className="text-xs align-top py-2">
                  <Badge variant="outline">{r.product ?? "OTHER"}</Badge>
                </TD>
                <TD className="text-xs align-top py-2">
                  <div className="flex gap-1.5 min-w-0">
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
                      <div className="font-medium text-slate-800 leading-snug break-words">{r.title}</div>
                      <div className="font-mono text-[10px] text-slate-500 break-all">{r.ruleCode}</div>
                      {!expanded ? (
                        <p className="mt-1 text-slate-500 text-[10px] leading-snug">
                          Expand for rationale and suggested action
                        </p>
                      ) : null}
                    </div>
                  </div>
                </TD>
                <TD className="pr-3 align-top py-2">
                  <div className="space-y-2 min-w-0">
                    {(r.acknowledgedAt ||
                      r.userEmailNotifiedAt ||
                      r.subjectDisabled ||
                      removalId) ? (
                      <div className="flex flex-wrap gap-1">
                        {r.acknowledgedAt ? (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                            Ack
                          </Badge>
                        ) : null}
                        {r.userEmailNotifiedAt ? (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                            Emailed
                          </Badge>
                        ) : null}
                        {r.subjectDisabled ? (
                          <Badge variant="warning" className="text-[10px] px-1.5 py-0 shrink-0">
                            Console off
                          </Badge>
                        ) : null}
                        {removalId ? (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0 shrink-0"
                            title={removalId}
                          >
                            Removal
                          </Badge>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="flex items-center gap-1.5">
                      {isRowPending(r.id) ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-500" />
                      ) : null}
                      <select
                        className={selectClass}
                        defaultValue=""
                        disabled={pending !== null}
                        aria-label={`Actions for alert ${r.ruleCode}`}
                        onChange={(e) => {
                          const v = e.target.value;
                          e.target.value = "";
                          void onActionSelect(r, v);
                        }}
                      >
                        <option value="">Choose action…</option>
                        {!r.acknowledgedAt ? (
                          <option value="ack">Acknowledge</option>
                        ) : null}
                        <option value="email" disabled={!canEmail}>
                          Email user
                        </option>
                        {canManageUsers ? (
                          <option value="disable" disabled={!canDisable}>
                            Block console
                          </option>
                        ) : null}
                        {canManageUsers ? (
                          <option value="enable" disabled={!canEnable}>
                            Allow console
                          </option>
                        ) : null}
                        <option
                          value="seat-removal"
                          disabled={!canSeatRemoval || Boolean(removalId)}
                        >
                          Request seat removal
                        </option>
                      </select>
                    </div>
                    {rowError[r.id] ? (
                      <p className="text-[10px] text-red-600 leading-snug break-words">{rowError[r.id]}</p>
                    ) : !coachingEmailConfigured && canEmail ? (
                      <p className="text-[10px] text-amber-700 leading-snug">
                        {emailProvider === "graph"
                          ? "Email needs GRAPH_MAIL_SENDER + Mail.Send on the Entra app."
                          : "Email needs RESEND_API_KEY in App Service / Key Vault."}
                      </p>
                    ) : null}
                  </div>
                </TD>
              </TR>
              {expanded ? (
                <TR className="bg-slate-50/80">
                  <TD colSpan={8} className="px-4 py-3 text-xs text-slate-700">
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
    </div>
  );
}
