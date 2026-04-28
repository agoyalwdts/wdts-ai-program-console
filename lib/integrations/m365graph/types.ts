/**
 * M365GraphClient — abstraction over Microsoft Graph for M365 Copilot
 * license + telemetry. Used by F13 (Copilot rationalisation review) per
 * scoping §4.6.6.
 *
 * Refs: Dashboard_Scoping_v1.md §4 integration #7; §8 N7 (service
 *       principal scopes: User.Read.All, Reports.Read.All,
 *       AuditLog.Read.All).
 */

export type CopilotLicense = {
  userId: string;
  email: string;
  /** Optional flag set by review heuristics, e.g. "likely-reclaim". */
  flag: string | null;
};

export type CopilotActivity = {
  userId: string;
  /** First of the period at 00:00 UTC. */
  periodStart: Date;
  /** Counts of feature interactions in the window. */
  features: {
    word: number;
    excel: number;
    powerpoint: number;
    outlook: number;
    teams: number;
    onenote: number;
    chat: number;
  };
};

export type M365GraphClient = {
  listLicenses(): Promise<CopilotLicense[]>;
  /** Per-user feature interaction counts for the given window. */
  listActivity(args: { since: Date; until?: Date }): Promise<CopilotActivity[]>;
};
