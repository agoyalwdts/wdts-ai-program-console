import { parseEmailList, sendResendHtmlEmail, escapeHtml, type ResendSendResult } from "./resend-send";

export type GuardrailAlertEmailLine = {
  category: string;
  severity: string;
  userEmail: string | null;
  product: string | null;
  model: string | null;
  ruleCode: string;
  title: string;
};

export type SendGuardrailDigestResult = ResendSendResult;

export async function sendGuardrailPolicyDigest(params: {
  dashboardBaseUrl: string;
  subject: string;
  lines: GuardrailAlertEmailLine[];
}): Promise<SendGuardrailDigestResult> {
  const toRaw =
    process.env.GUARDRAIL_ALERT_EMAIL_TO?.trim() ?? process.env.CURSOR_ALERT_EMAIL_TO?.trim();
  const to = parseEmailList(toRaw);
  if (!to.length) return { ok: true, skipped: true, reason: "GUARDRAIL_ALERT_EMAIL_TO unset" };

  const rows = params.lines
    .map(
      (l) =>
        `<tr><td style="padding:6px;border:1px solid #e2e8f0">${escapeHtml(l.category)}</td>` +
        `<td style="padding:6px;border:1px solid #e2e8f0">${escapeHtml(l.severity)}</td>` +
        `<td style="padding:6px;border:1px solid #e2e8f0">${escapeHtml(l.userEmail ?? "—")}</td>` +
        `<td style="padding:6px;border:1px solid #e2e8f0">${escapeHtml(l.product ?? "—")}</td>` +
        `<td style="padding:6px;border:1px solid #e2e8f0">${escapeHtml(l.model ?? "—")}</td>` +
        `<td style="padding:6px;border:1px solid #e2e8f0">${escapeHtml(l.ruleCode)}</td>` +
        `<td style="padding:6px;border:1px solid #e2e8f0">${escapeHtml(l.title)}</td></tr>`,
    )
    .join("");

  const listUrl = `${params.dashboardBaseUrl.replace(/\/$/, "")}/settings/guardrails`;
  const html = `<p>New guardrail policy alert(s):</p><table style="border-collapse:collapse">${rows}</table><p><a href="${escapeHtml(listUrl)}">Open dashboard</a></p>`;

  return sendResendHtmlEmail({ to, subject: params.subject, html });
}
