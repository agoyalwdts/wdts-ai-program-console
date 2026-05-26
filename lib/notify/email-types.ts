/** Shared result shape for Resend and Microsoft Graph mail. */
export type SendHtmlEmailResult =
  | { ok: true; skipped: false; id: string }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

export type EmailProvider = "graph" | "resend";
