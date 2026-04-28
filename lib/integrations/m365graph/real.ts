/**
 * Real M365GraphClient — calls Microsoft Graph for M365 Copilot license
 * + activity. Reuses the app-only token + paginator from
 * `lib/integrations/azuread/graph.ts`.
 *
 * Endpoints used:
 *
 *   listLicenses():
 *     GET /users
 *       ?$select=id,mail,userPrincipalName,assignedLicenses
 *       ?$filter=assignedLicenses/any(x:x/skuId eq <copilot-sku-id>)
 *
 *     There's no first-class "Copilot licenses" endpoint; the canonical
 *     way is to filter /users by SKU id. The SKU id list comes from the
 *     M365_COPILOT_SKU_IDS env var (comma-separated UUIDs) so a future
 *     agent can update it without a code change. The default list
 *     contains the Microsoft 365 Copilot SKU id documented at
 *     https://learn.microsoft.com/azure/active-directory/enterprise-users/licensing-service-plan-reference.
 *
 *   listActivity({ since, until }):
 *     GET /reports/getMicrosoft365CopilotUsageUserDetail(period='D<n>')
 *
 *     The reports API returns one row per user with last-activity-date
 *     fields per Copilot-enabled app (word, excel, powerpoint, outlook,
 *     teams, onenote, chat). The shape doesn't carry interaction counts,
 *     so we lossy-map: feature.<x> = 1 if the user touched that feature
 *     within the [since, until] window, else 0. This preserves the
 *     CopilotActivity contract while being honest about the fidelity gap.
 *
 *     The period argument must be one of D7 / D30 / D90 / D180. We round
 *     up to the smallest period that covers the requested window.
 *
 * Required permissions (admin consent):
 *   User.Read.All   (or Directory.Read.All) — for /users
 *   Reports.Read.All                          — for /reports
 *
 * Refs: scoping §4 integration #7; §8 N7.
 */

import { IntegrationError } from "../errors";
import {
  graphGet,
  graphPaginate,
  readGraphConfigFromEnv,
  type GraphConfig,
} from "../azuread/graph";
import type {
  CopilotActivity,
  CopilotLicense,
  M365GraphClient,
} from "./types";

/**
 * Microsoft 365 Copilot SKU ids. Default list per Microsoft's licensing
 * reference. Override via M365_COPILOT_SKU_IDS=comma,separated,uuids.
 */
const DEFAULT_COPILOT_SKU_IDS = [
  "639dec6b-bb19-468b-871c-c5c441c4b0cb", // Microsoft 365 Copilot
];

function readSkuIds(env: Record<string, string | undefined>): string[] {
  const raw = env.M365_COPILOT_SKU_IDS;
  if (!raw) return DEFAULT_COPILOT_SKU_IDS;
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_COPILOT_SKU_IDS;
}

type GraphUserWithLicenses = {
  id: string;
  mail: string | null;
  userPrincipalName: string | null;
  assignedLicenses?: { skuId: string }[];
};

async function listUsersWithCopilotLicense(
  cfg: GraphConfig,
  skuIds: string[],
): Promise<CopilotLicense[]> {
  // Graph $filter on assignedLicenses/any uses skuId equality, not 'in'.
  // For multiple SKUs we OR them together. Each SKU runs its own query
  // and we de-dupe — simpler than building a long filter string and
  // hitting the URL-length cap when WDTS adds more Copilot SKUs.
  const seen = new Set<string>();
  const out: CopilotLicense[] = [];
  for (const sku of skuIds) {
    const path =
      `/users?$filter=assignedLicenses/any(x:x/skuId eq ${sku})` +
      `&$select=id,mail,userPrincipalName,assignedLicenses&$top=999&$count=true`;
    for await (const page of graphPaginate<GraphUserWithLicenses>(cfg, path)) {
      for (const g of page) {
        if (seen.has(g.id)) continue;
        seen.add(g.id);
        out.push({
          userId: g.id,
          email: g.mail ?? g.userPrincipalName ?? "",
          flag: null,
        });
      }
    }
  }
  return out;
}

/** Snap a window in days to the nearest Graph reports period (D7/D30/D90/D180).
 *  Always rounds up so we don't under-cover the requested window. */
function pickReportPeriod(sinceDate: Date, until: Date): "D7" | "D30" | "D90" | "D180" {
  const days = Math.max(
    1,
    Math.ceil((until.getTime() - sinceDate.getTime()) / (1000 * 60 * 60 * 24)),
  );
  if (days <= 7) return "D7";
  if (days <= 30) return "D30";
  if (days <= 90) return "D90";
  return "D180";
}

type CopilotUsageRow = {
  /** Either the userPrincipalName or 'Redacted' if anonymisation is on. */
  userPrincipalName: string;
  reportRefreshDate: string;
  lastActivityDate: string | null;
  wordCopilotLastActivityDate?: string | null;
  excelCopilotLastActivityDate?: string | null;
  powerPointCopilotLastActivityDate?: string | null;
  outlookCopilotLastActivityDate?: string | null;
  teamsCopilotLastActivityDate?: string | null;
  oneNoteCopilotLastActivityDate?: string | null;
  copilotChatLastActivityDate?: string | null;
};

function inWindow(
  iso: string | null | undefined,
  since: Date,
  until: Date,
): boolean {
  if (!iso) return false;
  const d = new Date(iso).getTime();
  return d >= since.getTime() && d <= until.getTime();
}

export const realM365GraphClient: M365GraphClient = {
  async listLicenses(): Promise<CopilotLicense[]> {
    const cfg = readGraphConfigFromEnv();
    const skuIds = readSkuIds(process.env);
    return listUsersWithCopilotLicense(cfg, skuIds);
  },

  async listActivity(args: {
    since: Date;
    until?: Date;
  }): Promise<CopilotActivity[]> {
    const cfg = readGraphConfigFromEnv();
    const until = args.until ?? new Date();
    if (until.getTime() < args.since.getTime()) {
      throw new IntegrationError(
        "m365graph",
        "listActivity: 'until' must be on or after 'since'.",
      );
    }
    const period = pickReportPeriod(args.since, until);
    // The reports endpoint is single-page (it's an aggregate function,
    // not a collection), so a plain GET is fine. Query string lives in
    // the path.
    const data = await graphGet<{ value: CopilotUsageRow[] }>(
      cfg,
      `/reports/getMicrosoft365CopilotUsageUserDetail(period='${period}')?$format=application/json`,
    );
    if (!data) return [];

    return data.value.map((row): CopilotActivity => ({
      userId: row.userPrincipalName,
      periodStart: args.since,
      features: {
        word: inWindow(row.wordCopilotLastActivityDate, args.since, until) ? 1 : 0,
        excel: inWindow(row.excelCopilotLastActivityDate, args.since, until) ? 1 : 0,
        powerpoint: inWindow(row.powerPointCopilotLastActivityDate, args.since, until)
          ? 1
          : 0,
        outlook: inWindow(row.outlookCopilotLastActivityDate, args.since, until) ? 1 : 0,
        teams: inWindow(row.teamsCopilotLastActivityDate, args.since, until) ? 1 : 0,
        onenote: inWindow(row.oneNoteCopilotLastActivityDate, args.since, until) ? 1 : 0,
        chat: inWindow(row.copilotChatLastActivityDate, args.since, until) ? 1 : 0,
      },
    }));
  },
};
