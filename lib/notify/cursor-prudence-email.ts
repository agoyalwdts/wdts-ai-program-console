/**
 * Optional email digest when new Cursor usage prudence alerts are created.
 * Uses the Resend HTTP API (no SDK). If env is unset, returns skipped.
 */

export type NewAlertLine = {
  userEmail: string;
  model: string;
  costUsd: number;
  ruleCode: string;
  title: string;
};

export type SendPrudenceDigestResult =
  | { ok: true; skipped: false; id: string }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

function parseToList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Sends one HTML email summarising new alerts. Caller updates
 * `emailNotifiedAt` after success.
 */
export async function sendCursorPrudenceDigest(params: {
  dashboardBaseUrl: string;
  subject: string;
  lines: NewAlertLine[];
}): Promise<SendPrudenceDigestResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  const toRaw = process.env.CURSOR_ALERT_EMAIL_TO?.trim();
  const from =
    process.env.CURSOR_ALERT_EMAIL_FROM?.trim() ??
    "WDTS AI Console <onboarding@resend.dev>";

  if (!key) {
    return { ok: true, skipped: true, reason: "RESEND_API_KEY unset" };
  }
  const to = parseToList(toRaw);
  if (!to.length) {
    return { ok: true, skipped: true, reason: "CURSOR_ALERT_EMAIL_TO unset" };
  }

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

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: params.subject,
      html,
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 500)}` };
  }
  let id = "";
  try {
    id = (JSON.parse(body) as { id?: string }).id ?? "";
  } catch {
    id = "";
  }
  return { ok: true, skipped: false, id };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
