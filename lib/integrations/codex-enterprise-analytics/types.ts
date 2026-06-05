/**
 * Codex Enterprise Analytics — OpenAPI codex-backend-enterprise-analytics.
 * GET https://api.chatgpt.com/v1/analytics/codex/workspaces/{workspace_id}/…
 */

export type CodexAccountUserActor = {
  type?: string;
  user_id: string;
  email?: string | null;
};

export type CodexUsageTotals = {
  threads: number;
  turns: number;
  credits: number;
};

export type CodexClientUsage = {
  client_id?: string;
  threads?: number;
  turns?: number;
  credits?: number;
  uncached_text_input_tokens?: number | null;
  cached_text_input_tokens?: number | null;
  text_output_tokens?: number | null;
  text_total_tokens?: number | null;
};

export type CodexModelUsage = {
  model: string;
  credits: number;
  speed?: string | null;
};

export type CodexCodeAttributionMetrics = {
  lines_added?: number;
  lines_removed?: number | null;
};

export type CodexUsageRow = {
  object: string;
  start_time: number;
  end_time: number;
  user_id?: string | null;
  actor?: CodexAccountUserActor | null;
  /** Legacy / optional top-level email when workspace allows it. */
  email?: string | null;
  totals: CodexUsageTotals;
  clients: CodexClientUsage[];
  models?: CodexModelUsage[] | null;
  code_attribution?: CodexCodeAttributionMetrics | null;
};

export type CodexCommentDetails = {
  p0: number;
  p1: number;
  p2: number;
};

export type CodexReviewsRow = {
  object: string;
  start_time: number;
  end_time: number;
  pull_request_reviews: number;
  comments: number;
  comment_details?: CodexCommentDetails;
};

export type CodexReactionDetails = {
  upvotes: number;
  downvotes: number;
  other: number;
};

export type CodexCommentResponseDetails = {
  engaged: number;
  reacted: number;
  upvoted: number;
  downvoted: number;
  reacted_other: number;
  replied: number;
};

export type CodexCodeReviewResponseRow = {
  object: string;
  start_time: number;
  end_time: number;
  pull_request_reviews: number;
  comments: number;
  replies: number;
  reactions: number;
  reaction_details?: CodexReactionDetails;
  comment_response_details?: CodexCommentResponseDetails;
};

export type CodexAnalyticsPage<T> = {
  object: string;
  data: T[];
  has_more: boolean;
  next_page?: string | null;
};

/** @deprecated use CodexAnalyticsPage */
export type CodexUsagePage = CodexAnalyticsPage<CodexUsageRow>;
