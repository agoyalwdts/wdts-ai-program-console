import { DAY_ONE_DEFAULT_MODEL, type ProductKey } from "@/lib/guardrails/day-one-defaults";
import { escapeHtml, sendResendHtmlEmail, type ResendSendResult } from "./resend-send";

export type GuardrailUserCoachingLine = {
  ruleCode: string;
  title: string;
  rationale: string;
  recommendation: string | null;
  product: string | null;
  model: string | null;
};

export type CursorUserCoachingLine = {
  ruleCode: string;
  title: string;
  rationale: string;
  model: string;
  costUsd: number;
};

function defaultForProduct(product: string | null): string | null {
  if (!product) return null;
  const key = product as ProductKey;
  if (key in DAY_ONE_DEFAULT_MODEL) return DAY_ONE_DEFAULT_MODEL[key];
  return null;
}

export async function sendGuardrailUserCoachingEmail(params: {
  to: string;
  lines: GuardrailUserCoachingLine[];
  bcc?: string[];
}): Promise<ResendSendResult> {
  const items = params.lines
    .map((l) => {
      const rec = l.recommendation ?? defaultForProduct(l.product);
      const meta =
        l.product || l.model
          ? ` <span style="color:#64748b">(${[l.product, l.model].filter(Boolean).map((x) => escapeHtml(x!)).join(" · ")})</span>`
          : "";
      return (
        `<li style="margin-bottom:12px">` +
        `<strong>${escapeHtml(l.title)}</strong>${meta}` +
        `<p style="margin:6px 0 0;font-size:14px">${escapeHtml(l.rationale)}</p>` +
        (rec
          ? `<p style="margin:4px 0 0;font-size:14px"><strong>Suggested:</strong> ${escapeHtml(rec)}</p>`
          : "") +
        `</li>`
      );
    })
    .join("");

  const html = `<p>Hi,</p>
<p>Our AI usage guardrails flagged recent activity that may be using a <strong>higher-cost model than the task needs</strong>. This is automated coaching — not a disciplinary action.</p>
<ul style="padding-left:20px">${items}</ul>
<p style="font-size:13px;color:#64748b">Tip: for quick edits, summaries, or small refactors, start with the day-one default model for your product. Reserve premium / thinking / Max tiers for genuinely complex work.</p>
<p style="font-size:13px">Questions? Reply to your manager or the AI program FinOps contact.</p>
<p style="font-size:12px;color:#94a3b8">WDTS AI Program Console — model coaching</p>`;

  const subject =
    params.lines.length === 1
      ? `[WDTS AI] Model tip: consider a lower-cost model`
      : `[WDTS AI] Model tips (${params.lines.length} items)`;

  return sendResendHtmlEmail({
    to: [params.to],
    subject,
    html,
    bcc: params.bcc,
  });
}

export async function sendCursorPrudenceUserCoachingEmail(params: {
  to: string;
  lines: CursorUserCoachingLine[];
  dashboardBaseUrl: string;
  bcc?: string[];
}): Promise<ResendSendResult> {
  const items = params.lines
    .map(
      (l) =>
        `<li style="margin-bottom:12px">` +
        `<strong>${escapeHtml(l.title)}</strong>` +
        ` · <code style="font-size:12px">${escapeHtml(l.model)}</code>` +
        ` · $${l.costUsd.toFixed(2)}` +
        `<p style="margin:6px 0 0;font-size:14px">${escapeHtml(l.rationale)}</p>` +
        `</li>`,
    )
    .join("");

  const html = `<p>Hi,</p>
<p>Your recent <strong>Cursor</strong> usage matched a prudence rule (expensive model or mode for the amount of work produced). Please review whether a lighter model or turning off Max mode would have been enough.</p>
<ul style="padding-left:20px">${items}</ul>
<p style="font-size:13px;color:#64748b">FinOps may follow up on repeated patterns. This message is meant as early coaching.</p>
<p style="font-size:12px;color:#94a3b8">WDTS AI Program Console — Cursor usage coaching</p>`;

  const subject =
    params.lines.length === 1
      ? `[WDTS AI] Cursor usage tip: review model choice`
      : `[WDTS AI] Cursor usage tips (${params.lines.length} items)`;

  return sendResendHtmlEmail({
    to: [params.to],
    subject,
    html,
    bcc: params.bcc,
  });
}
