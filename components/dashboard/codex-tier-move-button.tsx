"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { CodexSubTier } from "@/lib/integrations/openai";

type MoveJson = {
  ok?: boolean;
  error?: string;
  decisionId?: string;
  prUrl?: string;
  prNumber?: number;
  fromSubTier?: CodexSubTier;
  toSubTier?: CodexSubTier;
};

export function CodexTierMoveButton({
  userId,
  email,
  displayName,
  currentTier,
  direction,
}: {
  userId: string;
  email: string;
  displayName: string;
  currentTier: CodexSubTier;
  direction: "promote" | "demote";
}) {
  const [open, setOpen] = useState(false);
  const [justification, setJustification] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");
  const [prUrl, setPrUrl] = useState<string | null>(null);

  const label = direction === "promote" ? "Promote" : "Demote";
  const defaultJustification =
    direction === "promote"
      ? `Codex promotion for ${displayName} (${email}): ${currentTier} candidate per F9 ladder (≥50% MTD cap utilisation proxy).`
      : `Codex demotion for ${displayName} (${email}): ${currentTier} candidate per F9 ladder (<10% MTD cap utilisation proxy).`;

  async function submit() {
    setStatus("loading");
    setMsg("");
    setPrUrl(null);
    try {
      const res = await fetch("/api/tier-moves/codex", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId,
          direction,
          justification: justification.trim() || defaultJustification,
        }),
      });
      const j = (await res.json()) as MoveJson;
      if (!res.ok || !j.ok) {
        throw new Error(j.error ?? res.statusText);
      }
      setStatus("ok");
      setMsg(
        j.toSubTier
          ? `${label}d to ${j.toSubTier}. Decision ${j.decisionId?.slice(0, 8)}…`
          : `${label} submitted.`,
      );
      if (j.prUrl) setPrUrl(j.prUrl);
      setOpen(false);
    } catch (e) {
      setStatus("err");
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          type="button"
          variant={direction === "promote" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setOpen(true);
            setJustification(defaultJustification);
            setStatus("idle");
            setMsg("");
          }}
        >
          {label}
        </Button>
        {status === "ok" && (
          <span className="text-xs text-emerald-700 max-w-[12rem] text-right">{msg}</span>
        )}
        {status === "err" && (
          <span className="text-xs text-red-700 max-w-[12rem] text-right">{msg}</span>
        )}
        {prUrl && (
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-sky-700 underline"
          >
            Open policy PR
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 min-w-[14rem]">
      <textarea
        className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
        rows={3}
        value={justification}
        onChange={(e) => setJustification(e.target.value)}
        aria-label={`Justification for ${label.toLowerCase()}`}
      />
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={status === "loading"} onClick={() => void submit()}>
          {status === "loading" ? "Opening PR…" : `Confirm ${label.toLowerCase()}`}
        </Button>
      </div>
    </div>
  );
}
