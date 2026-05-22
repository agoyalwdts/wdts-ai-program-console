/**
 * OpenAI Compliance Logs Platform — ChatGPT Enterprise / Edu workspace audit.
 * @see https://developers.openai.com/cookbook/examples/chatgpt/compliance_api/logs_platform
 */

export type ComplianceLogsListResponse = {
  object?: string;
  data?: Array<{ id: string; event_type?: string }>;
  has_more?: boolean;
  last_end_time?: string | null;
};

export type ComplianceAuthLogIpSummary =
  | {
      available: true;
      distinctIps: string[];
      authEventCount: number;
      lookbackDays: number;
      logFilesScanned: number;
    }
  | {
      available: false;
      reason: string;
    };
