/**
 * Codex Enterprise Analytics — response shapes for
 * GET https://api.chatgpt.com/v1/analytics/codex/workspaces/{workspace_id}/usage
 *
 * See vendor OpenAPI (codex-backend-enterprise-analytics).
 */

export type CodexUsageTotals = {
  threads: number;
  turns: number;
  credits: number;
};

export type CodexUsageRow = {
  object: string;
  start_time: number;
  end_time: number;
  user_id?: string | null;
  totals: CodexUsageTotals;
  clients: Array<{
    client_id?: string;
    threads?: number;
    turns?: number;
    credits?: number;
  }>;
};

export type CodexUsagePage = {
  object: string;
  data: CodexUsageRow[];
  has_more: boolean;
  next_page?: string | null;
};
