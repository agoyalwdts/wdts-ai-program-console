/**
 * AnthropicClient — abstraction over the Anthropic / Claude.ai workspace
 * admin API. Returns the 30-seat allocation state per scoping §4.6.5.
 *
 * Refs: Dashboard_Scoping_v1.md §4 integration #6.
 */

export type ClaudeSeat = {
  userId: string;
  email: string;
  /** Free-form sub-tier identifier — documentation_heavy, etc. */
  subTier: string;
  capUsdMonth: number;
};

export type AnthropicClient = {
  listSeats(): Promise<ClaudeSeat[]>;
};
