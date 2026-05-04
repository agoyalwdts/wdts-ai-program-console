/**
 * Placeholder for a future **pull** integration when the gateway vendor
 * exposes a queryable audit/export API. Today the mirror is **push-only**
 * (HMAC generic ingest + LiteLLM generic_api); see `docs/gateway-and-litellm.md`.
 */

export type RemoteGatewayPullResult =
  | { ok: true; pulled: false; detail: string }
  | { ok: false; error: string };

/**
 * Reserved hook — does not perform network I/O. Call sites (cron, admin
 * actions) should treat `pulled: false` as a no-op until a real client lands.
 */
export async function pullRemoteGatewayUsageMirror(): Promise<RemoteGatewayPullResult> {
  return {
    ok: true,
    pulled: false,
    detail:
      "Remote gateway vendor HTTP pull is not implemented; usage mirror is webhook-driven only.",
  };
}
