export type GuardrailAlertEmailLine = {
  category: string;
  severity: string;
  userEmail: string | null;
  product: string | null;
  model: string | null;
  ruleCode: string;
  title: string;
};

export type SendGuardrailDigestResult =
  | { ok: true; skipped: false; id: string }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

function parseToList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[;,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function sendGuardrailPolicyDigest(params: {
  dashboardBaseUrl: string;
  subject: string;
  lines: GuardrailAlertEmailLine[];
}): Promise<SendGuardrailDigestResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  const toRaw =
    process.env.GUARDRAIL_ALERT_EMAIL_TO?.trim() ?? process.env.CURSOR_ALERT_EMAIL_TO?.trim();
  const from =
    process.env.GUARDRAIL_ALERT_EMAIL_FROM?.trim() ??
    process.env.CURSOR_ALERT_EMAIL_FROM?.trim() ??
    "WDTS AI Console <onboarding@resend.dev>";

  if (!key) return { ok: true, skipped: true, reason: "RESEND_API_KEY unset" };
  const to = parseToList(toRaw);
  if (!to.length) return { ok: true, skipped: true, reason: "GUARDRAIL_ALERT_EMAIL_TO unset" };

  const rows = params.lines
    .map(
      (l) =>
        `<tr><td style=\"padding:6px;border:1px solid #e2e8f0\">${esc(l.category)}</td>` +
        `<td style=\"padding:6px;border:1px solid #e2e8f0\">${esc(l.severity)}</td>` +
        `<td style=\"padding:6px;border:1px solid #e2e8f0\">${esc(l.userEmail ?? "—")}</td>` +
        `<td style=\"padding:6px;border:1px solid #e2e8f0\">${esc(l.product ?? "—")}</td>` +
        `<td style=\"padding:6px;border:1px solid #e2e8f0\">${esc(l.model ?? "—")}</td>` +
        `<td style=\"padding:6px;border:1px solid #e2e8f0\">${esc(l.ruleCode)}</td>` +
        `<td style=\"padding:6px;border:1px solid #e2e8f0\">${esc(l.title)}</td></tr>`,
    )
    .join("");

  const listUrl = `${params.dashboardBaseUrl.replace(/\/$/, "")}/settings/guardrails`;
  const html = `<p>New guardrail policy alert(s):</p><table style=\"border-collapse:collapse\">${rows}</table><p><a href=\"${esc(listUrl)}\">Open dashboard</a></p>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject: params.subject, html }),
  });

  const text = await res.text();
  if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${text.slice(0, 500)}` };
  let id = "";
  try {
    id = (JSON.parse(text) as { id?: string }).id ?? "";
  } catch {
    id = "";
  }
  return { ok: true, skipped: false, id };
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}
