/**
 * OpenAI Compliance Logs Platform — ChatGPT Enterprise / Edu workspace audit.
 * @see https://developers.openai.com/cookbook/examples/chatgpt/compliance_api/logs_platform
 */

export type ComplianceLogFileMeta = {
  id: string;
  event_type?: string;
  end_time?: string;
  file_name?: string;
  file_size?: number;
  file_sha256?: string;
};

export type ComplianceLogsListResponse = {
  object?: string;
  data?: ComplianceLogFileMeta[];
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
