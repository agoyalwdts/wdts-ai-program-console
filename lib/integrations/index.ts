/**
 * Integration layer — abstraction over every external system the dashboard
 * reads from or writes to. See Dashboard_Scoping_v1.md §4 for the design
 * principle (interface + synthetic + real, env-driven selection) and the
 * table of which integration unlocks which features.
 *
 * Pattern for adding a new integration:
 *   1. Create `lib/integrations/<name>/types.ts` with the interface.
 *   2. Create `lib/integrations/<name>/synthetic.ts` (returns deterministic
 *      data, ideally sourced from the dev DB so it's consistent across
 *      pages and tests).
 *   3. Create `lib/integrations/<name>/real.ts` that throws
 *      `NotImplementedError` until wired.
 *   4. Create `lib/integrations/<name>/index.ts` exporting `get<Name>Client()`.
 *   5. Register the name in `lib/integrations/env.ts` (`IntegrationName`
 *      union and the `ENV_KEY` map).
 *   6. Re-export from this file.
 *   7. Default new vars to `synthetic` in dev; flip per-env in staging/prod.
 */

export { getGatewayClient } from "./gateway";
export type {
  DailyProgramAggregate,
  GatewayClient,
  ManagerQueueRow,
  ProgramAggregate,
  TopSpender,
  UsageAggregate,
  UsageDecision,
  UsageRecord,
} from "./gateway";

export { getCursorClient } from "./cursor";
export type {
  CursorClient,
  CursorSeat,
  CursorSubTier,
  CursorWaitlistEntry,
  CursorWaitlistReason,
} from "./cursor";

export { getOpenAIClient } from "./openai";
export type { OpenAIClient, ChatGptSeat, CodexSeat, CodexSubTier } from "./openai";

export { getAnthropicClient } from "./anthropic";
export type { AnthropicClient, ClaudeSeat } from "./anthropic";

export { getM365GraphClient } from "./m365graph";
export type { M365GraphClient, CopilotActivity, CopilotLicense } from "./m365graph";

export { getAzureADClient } from "./azuread";
export type { AzureADClient, IdentityUser } from "./azuread";

export { getDeelClient } from "./deel";
export type { DeelClient, DeelEmployee, DeelWebhookEvent } from "./deel";

export { getPolicyRepoClient } from "./policyrepo";
export type { PolicyRepoClient, PolicyChange, PolicyPullRequest } from "./policyrepo";

export { NotImplementedError, IntegrationError } from "./errors";
export {
  getIntegrationMode,
  getAllIntegrationModes,
  INTEGRATION_NAMES,
} from "./env";
export type { IntegrationMode, IntegrationName } from "./env";
