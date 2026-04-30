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

/**
 * Embedded manager shape Graph returns when `$expand=manager` is on
 * `/users`. The selected fields mirror what we ask for in the listUsers
 * query string. The `manager` field is `null` for top-of-org users and
 * may be missing entirely on tenants where the directory has no
 * manager links — both treated as "no manager".
 */
type GraphManager = {
  id: string | null;
  mail: string | null;
  userPrincipalName: string | null;
};

type GraphUser = {
  id: string;
  displayName: string | null;
  mail: string | null;
  userPrincipalName: string | null;
  accountEnabled: boolean | null;
  manager?: GraphManager | null;
};

function emailFromGraphManager(m: GraphManager | null | undefined): string | null {
  if (!m) return null;
  return m.mail ?? m.userPrincipalName ?? null;
}

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
    // $expand=manager pulls the manager edge in a single Graph call —
    // an N+1 shape is what kept this null in v0.2 / v0.3.
    // The inner $select on `manager(...)` is the documented Graph syntax
    // for restricting the embedded object's fields.
    const path =
      "/users?" +
      "$select=id,displayName,mail,userPrincipalName,accountEnabled" +
      "&$expand=manager($select=id,mail,userPrincipalName)" +
      "&$top=999";
    for await (const page of graphPaginate<GraphUser>(cfg, path)) {
      for (const g of page) {
        out.push(toIdentityUser(g, emailFromGraphManager(g.manager)));
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
