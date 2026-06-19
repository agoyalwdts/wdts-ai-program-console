export type UnifiedCreditsEnvelope = {
  event_id: string;
  type: string;
  timestamp?: string;
  payload: Record<string, unknown>;
};

export type UnifiedCreditsBillingLine = {
  sku: string;
  credits: number;
};

export type UnifiedCreditsRow = {
  event_id: string;
  /** UTC reporting date YYYY-MM-DD */
  day: string;
  hour: number;
  user_id?: string;
  email?: string;
  name?: string;
  product?: string;
  surface?: string;
  client?: string;
  model?: string;
  service_tier?: string;
  billing: UnifiedCreditsBillingLine[];
  credits_total: number;
  raw: Record<string, unknown>;
};

export type UnifiedCreditsSyncState = {
  version: 1;
  lastEndTime: string | null;
  recentEventIds: string[];
  recentLogFileIds: string[];
};

export type UnifiedCreditsSyncResult = {
  ok: boolean;
  reason?: string;
  /** API rejected event_type=COSTS — workspace enablement pending on OpenAI side. */
  notEnabled?: boolean;
  filesListed: number;
  filesDownloaded: number;
  recordsParsed: number;
  recordsSkippedDuplicate: number;
  snapshotsWritten: number;
  vendorDaysUpserted: number;
  vendorUserDaysUpserted: number;
  lastEndTime: string | null;
};
