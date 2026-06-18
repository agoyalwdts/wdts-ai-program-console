"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export type ReclamationRow = {
  id: string;
  state: string;
  subjectUserId: string;
  subjectEmail: string;
  subjectDisplayName: string;
  disputeWindowEndsAt: string | null;
  canDispute: boolean;
  canResolve: boolean;
};

export function ReclamationTriggerButton({
  userId,
  email,
  displayName,
  idleDays,
}: {
  userId: string;
  email: string;
  displayName: string;
  idleDays: number;
}) {
  const [open, setOpen] = useState(false);
  const [justification, setJustification] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");

  const defaultJustification = `${displayName} (${email}): ${idleDays} days idle on Cursor seat — open 5-business-day dispute window per §4.6.4.`;

  async function submit() {
    setStatus("loading");
    setMsg("");
    try {
      const res = await fetch("/api/reclamations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId,
          product: "CURSOR",
          trigger: "IDLE",
          justification: justification.trim() || defaultJustification,
        }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error ?? res.statusText);
      setStatus("ok");
      setMsg("Reclamation opened.");
      setOpen(false);
    } catch (e) {
      setStatus("err");
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          Open reclamation
        </Button>
        {status === "ok" && <span className="text-xs text-emerald-700">{msg}</span>}
        {status === "err" && <span className="text-xs text-red-700">{msg}</span>}
      </div>
    );
  }

  return (
    <div className="space-y-2 min-w-[14rem]">
      <textarea
        className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
        rows={3}
        value={justification || defaultJustification}
        onChange={(e) => setJustification(e.target.value)}
      />
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={status === "loading"} onClick={() => void submit()}>
          {status === "loading" ? "Saving…" : "Confirm"}
        </Button>
      </div>
    </div>
  );
}

export function ActiveReclamationsPanel({ rows }: { rows: ReclamationRow[] }) {
  if (rows.length === 0) return null;

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <ReclamationRowActions key={row.id} row={row} />
      ))}
    </div>
  );
}

function ReclamationRowActions({ row }: { row: ReclamationRow }) {
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");
  const [prUrl, setPrUrl] = useState<string | null>(null);

  async function dispute() {
    setStatus("loading");
    try {
      const res = await fetch(`/api/reclamations/${row.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ disputeReason }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error ?? res.statusText);
      setStatus("ok");
      setMsg("Dispute recorded.");
      setDisputeOpen(false);
    } catch (e) {
      setStatus("err");
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function resolve(outcome: "retain" | "reclaim") {
    setStatus("loading");
    try {
      const res = await fetch(`/api/reclamations/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; event?: { prUrl?: string | null } };
      if (!res.ok || !j.ok) throw new Error(j.error ?? res.statusText);
      setStatus("ok");
      setMsg(outcome === "retain" ? "Seat retained." : "Reclaim finalized.");
      if (j.event?.prUrl) setPrUrl(j.event.prUrl);
    } catch (e) {
      setStatus("err");
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  const windowEnd = row.disputeWindowEndsAt
    ? new Date(row.disputeWindowEndsAt).toISOString().slice(0, 10)
    : "—";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 px-4 py-3">
      <div>
        <div className="font-medium text-slate-900">{row.subjectDisplayName}</div>
        <div className="text-xs text-slate-500">{row.subjectEmail}</div>
        <div className="mt-1 flex items-center gap-2">
          <Badge variant={row.state === "IN_DISPUTE" ? "warning" : "secondary"}>{row.state}</Badge>
          <span className="text-xs text-slate-500">Dispute window ends {windowEnd}</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <div className="flex flex-wrap gap-2 justify-end">
          {row.canDispute && !disputeOpen && (
            <Button type="button" variant="outline" size="sm" onClick={() => setDisputeOpen(true)}>
              Dispute
            </Button>
          )}
          {row.canResolve && (
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => void resolve("retain")}>
                Retain seat
              </Button>
              <Button type="button" size="sm" onClick={() => void resolve("reclaim")}>
                Reclaim
              </Button>
            </>
          )}
        </div>
        {disputeOpen && (
          <div className="space-y-2 w-full min-w-[16rem]">
            <textarea
              className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
              rows={2}
              placeholder="Why should the seat be retained?"
              value={disputeReason}
              onChange={(e) => setDisputeReason(e.target.value)}
            />
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => setDisputeOpen(false)}>
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={status === "loading"} onClick={() => void dispute()}>
                Submit dispute
              </Button>
            </div>
          </div>
        )}
        {status === "ok" && <span className="text-xs text-emerald-700">{msg}</span>}
        {status === "err" && <span className="text-xs text-red-700">{msg}</span>}
        {prUrl && (
          <a href={prUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-700 underline">
            Policy PR
          </a>
        )}
      </div>
    </div>
  );
}
