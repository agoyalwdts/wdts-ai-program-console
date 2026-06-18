import type { IntegrationMode } from "@/lib/integrations/env";

export type GuardrailFeedStatus = {
  cursorMode: IntegrationMode;
  codexMode: IntegrationMode;
  gatewayMode: IntegrationMode;
  /** Cursor and/or Codex vendor APIs supply guardrail scans in prod. */
  vendorFeedsActive: boolean;
};

export function resolveGuardrailFeedStatus(args: {
  cursorMode: IntegrationMode;
  codexMode: IntegrationMode;
  gatewayMode: IntegrationMode;
}): GuardrailFeedStatus {
  const vendorFeedsActive = args.cursorMode === "real" || args.codexMode === "real";
  return { ...args, vendorFeedsActive };
}
