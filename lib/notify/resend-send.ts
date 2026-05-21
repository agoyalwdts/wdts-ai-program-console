/**
 * Minimal Resend HTTP client shared by operator digests and end-user coaching mail.
 */

export type ResendSendResult =
  | { ok: true; skipped: false; id: string }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

export function parseEmailList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[;,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function truthyEnv(raw: string | undefined): boolean {
  if (!raw?.trim()) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function defaultResendFrom(): string {
  return (
    process.env.GUARDRAIL_ALERT_EMAIL_FROM?.trim() ??
    process.env.CURSOR_ALERT_EMAIL_FROM?.trim() ??
    "WDTS AI Console <onboarding@resend.dev>"
  );
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendResendHtmlEmail(params: {
  to: string[];
  subject: string;
  html: string;
  from?: string;
  bcc?: string[];
}): Promise<ResendSendResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { ok: true, skipped: true, reason: "RESEND_API_KEY unset" };

  const to = params.to.filter(Boolean);
  if (!to.length) return { ok: true, skipped: true, reason: "no recipients" };

  const body: Record<string, unknown> = {
    from: params.from ?? defaultResendFrom(),
    to,
    subject: params.subject,
    html: params.html,
  };
  const bcc = params.bcc?.filter(Boolean);
  if (bcc?.length) body.bcc = bcc;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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
