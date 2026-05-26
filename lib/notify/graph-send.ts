/**
 * Outbound HTML mail via Microsoft Graph sendMail (app-only + shared mailbox).
 * Requires Mail.Send (application) and GRAPH_MAIL_SENDER (mailbox UPN).
 */

import {
  graphPost,
  readGraphConfigFromEnv,
  type GraphConfig,
} from "@/lib/integrations/azuread/graph";
import { IntegrationError } from "@/lib/integrations/errors";
import type { SendHtmlEmailResult } from "./email-types";

function graphRecipient(address: string) {
  return { emailAddress: { address } };
}

function buildSendMailPayload(args: {
  subject: string;
  html: string;
  to: string[];
  bcc?: string[];
}) {
  return {
    message: {
      subject: args.subject,
      body: {
        contentType: "HTML",
        content: args.html,
      },
      toRecipients: args.to.map(graphRecipient),
      ...(args.bcc?.length ? { bccRecipients: args.bcc.map(graphRecipient) } : {}),
    },
    saveToSentItems: true,
  };
}

export async function sendGraphHtmlEmail(args: {
  to: string[];
  subject: string;
  html: string;
  bcc?: string[];
  env?: Record<string, string | undefined>;
  cfg?: GraphConfig;
}): Promise<SendHtmlEmailResult> {
  const env = args.env ?? process.env;
  const sender = env.GRAPH_MAIL_SENDER?.trim();
  if (!sender) {
    return { ok: true, skipped: true, reason: "GRAPH_MAIL_SENDER unset" };
  }

  let cfg: GraphConfig;
  try {
    cfg = args.cfg ?? readGraphConfigFromEnv(env);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Azure AD Graph config missing",
    };
  }

  const to = args.to.filter(Boolean);
  if (!to.length) return { ok: true, skipped: true, reason: "no recipients" };

  const path = `/users/${encodeURIComponent(sender)}/sendMail`;
  const body = buildSendMailPayload({
    subject: args.subject,
    html: args.html,
    to,
    bcc: args.bcc,
  });

  try {
    await graphPost(cfg, path, body);
    return { ok: true, skipped: false, id: `graph:${sender}:${Date.now()}` };
  } catch (e) {
    const msg =
      e instanceof IntegrationError
        ? String(e)
        : e instanceof Error
          ? e.message
          : "Graph sendMail failed";
    return { ok: false, error: msg };
  }
}
