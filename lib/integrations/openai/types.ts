/**
 * OpenAIClient — abstraction over OpenAI's admin API for ChatGPT and Codex
 * seat / sub-tier / cap state. Per-request usage data flows through
 * GatewayClient; this client surfaces the seat-level allocation state.
 *
 * Refs: Dashboard_Scoping_v1.md §4 integration #5; §4.6.2 (Codex tiers).
 */

export type CodexSubTier = "POWER" | "STANDARD" | "LIGHT" | "DISCOVERY";

export type ChatGptSeat = {
  userId: string;
  email: string;
  capUsdMonth: number;
};

export type CodexSeat = {
  userId: string;
  email: string;
  subTier: CodexSubTier;
  capUsdMonth: number;
};

export type OpenAIClient = {
  listChatGptSeats(): Promise<ChatGptSeat[]>;
  listCodexSeats(): Promise<CodexSeat[]>;
};
