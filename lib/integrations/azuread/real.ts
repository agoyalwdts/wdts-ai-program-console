/**
 * Real AzureADClient — Microsoft Graph (app-only auth).
 *
 * Endpoints:
 *   GET /users                         — listUsers (paginated)
 *   GET /users/{id-or-upn}             — getUserByEmail (404 → null)
 *   GET /users/{id-or-upn}/manager     — getManager (404 → null)
 *
 * App registration must have either Directory.Read.All or User.Read.All
 * granted with admin consent. See lib/integrations/azuread/graph.ts for
 * the token + error story.
 *
 * Note for v0.2: when INTEGRATION_AZUREAD=real is flipped, the join
 * F1 / F2 / F3 do between userId (Prisma User.id) and Graph
 * azureObjectId will only match for users that have been reconciled
 * into the local User table. The reconciler lands in v0.3; for now,
 * this client is exercised via the /settings probe widget (PR 10) and
 * by mocked unit tests (./real.test.ts).
 */

import type { AzureADClient, IdentityUser } from "./types";
import {
  graphGet,
  graphPaginate,
  readGraphConfigFromEnv,
  type GraphConfig,
} from "./graph";

type GraphUser = {
  id: string;
  displayName: string | null;
  mail: string | null;
  userPrincipalName: string | null;
  accountEnabled: boolean | null;
};

function toIdentityUser(g: GraphUser, managerEmail: string | null): IdentityUser {
  // Graph users may have a null `mail` if the mailbox isn't licensed; the
  // userPrincipalName is the next-best stable handle.
  const email = g.mail ?? g.userPrincipalName ?? "";
  return {
    email,
    displayName: g.displayName ?? email,
    azureObjectId: g.id,
    managerEmail,
    status: g.accountEnabled === false ? "SUSPENDED" : "ACTIVE",
  };
}

async function fetchManagerEmail(
  cfg: GraphConfig,
  upn: string | null,
): Promise<string | null> {
  if (!upn) return null;
  const m = await graphGet<GraphUser>(
    cfg,
    `/users/${encodeURIComponent(upn)}/manager?$select=id,displayName,mail,userPrincipalName,accountEnabled`,
    { acceptNotFound: true },
  );
  if (!m) return null;
  return m.mail ?? m.userPrincipalName ?? null;
}

export const realAzureADClient: AzureADClient = {
  async listUsers(): Promise<IdentityUser[]> {
    const cfg = readGraphConfigFromEnv();
    const out: IdentityUser[] = [];
    // $select to keep the payload small + predictable.
    const path =
      "/users?$select=id,displayName,mail,userPrincipalName,accountEnabled&$top=999";
    for await (const page of graphPaginate<GraphUser>(cfg, path)) {
      for (const g of page) {
        // Listing managers per-user is N+1 on Graph; v0.2 leaves the
        // managerEmail empty in bulk listings to keep things fast. The
        // detail endpoints (getUserByEmail / getManager) populate it.
        out.push(toIdentityUser(g, null));
      }
    }
    return out;
  },

  async getUserByEmail(email: string): Promise<IdentityUser | null> {
    if (!email) return null;
    const cfg = readGraphConfigFromEnv();
    const g = await graphGet<GraphUser>(
      cfg,
      `/users/${encodeURIComponent(email)}?$select=id,displayName,mail,userPrincipalName,accountEnabled`,
      { acceptNotFound: true },
    );
    if (!g) return null;
    const managerEmail = await fetchManagerEmail(cfg, g.userPrincipalName ?? email);
    return toIdentityUser(g, managerEmail);
  },

  async getManager(email: string): Promise<IdentityUser | null> {
    if (!email) return null;
    const cfg = readGraphConfigFromEnv();
    const g = await graphGet<GraphUser>(
      cfg,
      `/users/${encodeURIComponent(email)}/manager?$select=id,displayName,mail,userPrincipalName,accountEnabled`,
      { acceptNotFound: true },
    );
    if (!g) return null;
    return toIdentityUser(g, null);
  },
};
