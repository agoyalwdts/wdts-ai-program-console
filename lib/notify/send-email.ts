import { emailProvider } from "./email-provider";
import type { SendHtmlEmailResult } from "./email-types";
import { sendGraphHtmlEmail } from "./graph-send";
import { sendResendHtmlEmail } from "./resend-send";

export type { SendHtmlEmailResult, EmailProvider } from "./email-types";
export {
  emailProvider,
  isEmailConfigured,
  defaultEmailFrom,
  hasAzureGraphMailCredentials,
} from "./email-provider";

/** Route HTML mail to Graph (M365) or Resend based on EMAIL_PROVIDER / env. */
export async function sendHtmlEmail(params: {
  to: string[];
  subject: string;
  html: string;
  from?: string;
  bcc?: string[];
  env?: Record<string, string | undefined>;
}): Promise<SendHtmlEmailResult> {
  const env = params.env ?? process.env;
  if (emailProvider(env) === "graph") {
    return sendGraphHtmlEmail({
      to: params.to,
      subject: params.subject,
      html: params.html,
      bcc: params.bcc,
      env,
    });
  }
  return sendResendHtmlEmail({
    to: params.to,
    subject: params.subject,
    html: params.html,
    from: params.from,
    bcc: params.bcc,
  });
}
