import type { Fetch } from "../_http";
import { CHATGPT_CAP_USD_MONTH } from "@/lib/program";
import { loadCodexLadderSeats } from "./codex-ladder-seats";
import { listOpenAiOrgMembers } from "./org-users";
import type { ChatGptSeat, OpenAIClient } from "./types";

/** ChatGPT cap is a flat $/month per scoping §4.6.2. */
const CHATGPT_DEFAULT_CAP = CHATGPT_CAP_USD_MONTH;

/** Factory exported for tests; also wired as the default singleton. */
export function makeRealOpenAIClient(opts?: {
  fetchImpl?: Fetch;
  env?: Record<string, string | undefined>;
}): OpenAIClient {
  return {
    async listChatGptSeats(): Promise<ChatGptSeat[]> {
      const users = await listOpenAiOrgMembers({ env: opts?.env, fetchImpl: opts?.fetchImpl });
      return users.map((u) => ({
        userId: u.id,
        email: u.email,
        displayName: u.displayName,
        capUsdMonth: CHATGPT_DEFAULT_CAP,
        mtdSpendUsd: 0,
      }));
    },

    async listCodexSeats() {
      const loaded = await loadCodexLadderSeats({ env: opts?.env, fetchImpl: opts?.fetchImpl });
      return loaded.seats;
    },
  };
}

export const realOpenAIClient = makeRealOpenAIClient();
