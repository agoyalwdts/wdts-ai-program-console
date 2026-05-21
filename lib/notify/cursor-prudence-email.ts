/**
 * Optional operator digest when new Cursor usage prudence alerts are created.
 * End-user coaching uses `lib/notify/notify-end-users.ts`.
 */

import { parseEmailList, sendResendHtmlEmail, escapeHtml, type ResendSendResult } from "./resend-send";

export type NewAlertLine = {
  userEmail: string;
  model: string;
  costUsd: number;
  ruleCode: string;
  title: string;
};

export type SendPrudenceDigestResult = ResendSendResult;

export async function sendCursorPrudenceDigest(params: {
  dashboardBaseUrl: string;
  subject: string;
  lines: NewAlertLine[];
}): Promise<SendPrudenceDigestResult> {
  const to = parseEmailList(process.env.CURSOR_ALERT_EMAIL_TO?.trim());
  if (!to.length) return { ok: true, skipped: true, reason: "CURSOR_ALERT_EMAIL_TO unset" };

  const rows = params.lines
    .map(
      (l) =>
        `<tr><td style="padding:6px;border:1px solid #e2e8f0;font-family:monospace;font-size:12px">${escapeHtml(l.userEmail)}</td>` +
        `<td style="padding:6px;border:1px solid #e2e8f0;font-size:12px">${escapeHtml(l.model)}</td>` +
        `<td style="padding:6px;border:1px solid #e2e8f0;font-size:12px">${l.costUsd.toFixed(2)}</td>` +
        `<td style="padding:6px;border:1px solid #e2e8f0;font-size:12px">${escapeHtml(l.ruleCode)}</td>` +
        `<td style="padding:6px;border:1px solid #e2e8f0;font-size:12px">${escapeHtml(l.title)}</td></tr>`,
    )
    .join("");

  const listUrl = `${params.dashboardBaseUrl.replace(/\/$/, "")}/settings/cursor-alerts`;
  const html = `<p>New Cursor usage prudence alert(s):</p>
<table style="border-collapse:collapse">${rows}</table>
<p style="font-size:13px"><a href="${escapeHtml(listUrl)}">Open dashboard</a></p>`;

  return sendResendHtmlEmail({ to, subject: params.subject, html });
}
