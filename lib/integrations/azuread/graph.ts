/**
 * Tiny Microsoft Graph client used by the real azuread integration.
 *
 * Why we hand-roll this instead of @azure/msal-node + @microsoft/microsoft-graph-client:
 *   - We need exactly two endpoints (`/users`, `/users/{id}/manager`) and
 *     the client-credentials token flow. Hand-rolling keeps the v0.2
 *     dependency surface small and the code 80 lines instead of 800.
 *   - When the dashboard moves to a managed identity in Azure App Service
 *     (scoping §6 Q3), this is the file that swaps to MSAL or the
 *     `@azure/identity` DefaultAzureCredential. Single replacement point.
 *
 * App-only auth (client_credentials flow) requires admin consent for
 * `Directory.Read.All` (or `User.Read.All`). The real client surfaces a
 * helpful error if Graph returns 403.
 */

import { IntegrationError } from "../errors";

type Token = { accessToken: string; expiresAt: number };
let cached: Token | null = null;

export type GraphConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

export function readGraphConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): GraphConfig {
  const tenantId = env.AZURE_AD_TENANT_ID;
  const clientId = env.AZURE_AD_CLIENT_ID;
  const clientSecret = env.AZURE_AD_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new IntegrationError(
      "azuread",
      "Missing AZURE_AD_TENANT_ID / AZURE_AD_CLIENT_ID / AZURE_AD_CLIENT_SECRET. " +
        "Set them in .env.local before flipping INTEGRATION_AZUREAD=real.",
    );
  }
  return { tenantId, clientId, clientSecret };
}

async function fetchToken(cfg: GraphConfig): Promise<Token> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const r = await fetch(
    `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new IntegrationError(
      "azuread",
      `Token endpoint returned ${r.status}: ${text || r.statusText}`,
    );
  }
  const json = (await r.json()) as { access_token: string; expires_in: number };
  // Refresh ~1 minute before expiry to absorb clock skew.
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
  };
}

export async function getAccessToken(cfg: GraphConfig): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;
  cached = await fetchToken(cfg);
  return cached.accessToken;
}

/**
 * GET against Graph with the cached app-only token. Returns the JSON
 * response. Throws IntegrationError with a helpful hint on 403 (the
 * common "admin consent not granted" case).
 */
export async function graphGet<T>(
  cfg: GraphConfig,
  path: string,
  opts?: { acceptNotFound?: boolean },
): Promise<T | null> {
  const token = await getAccessToken(cfg);
  const url = path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" },
  });
  if (r.status === 404 && opts?.acceptNotFound) return null;
  if (r.status === 403) {
    throw new IntegrationError(
      "azuread",
      `Graph returned 403 on ${path}. The most common cause is missing admin consent ` +
        `on the app registration. Required scopes by endpoint: ` +
        `/users → User.Read.All (or Directory.Read.All); ` +
        `/reports → Reports.Read.All; ` +
        `/auditLogs → AuditLog.Read.All. ` +
        `Re-run "Grant admin consent for <tenant>" in the Azure portal after ` +
        `adding the missing one.`,
    );
  }
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new IntegrationError(
      "azuread",
      `Graph GET ${path} returned ${r.status}: ${text || r.statusText}`,
    );
  }
  return (await r.json()) as T;
}

/** Iterate over a paginated Graph collection, yielding values in chunks. */
export async function* graphPaginate<T>(
  cfg: GraphConfig,
  initialPath: string,
): AsyncGenerator<T[], void, void> {
  type Page = { value: T[]; "@odata.nextLink"?: string };
  let nextLink: string | null = initialPath;
  while (nextLink) {
    const page: Page | null = await graphGet<Page>(cfg, nextLink);
    if (!page) return;
    yield page.value;
    nextLink = page["@odata.nextLink"] ?? null;
  }
}

/** Reset the cached token. Test-only. */
export function _resetTokenCacheForTests() {
  cached = null;
}
