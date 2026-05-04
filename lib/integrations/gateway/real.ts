/**
 * Real GatewayClient — reads `UsageRecord` rows mirrored into Postgres.
 *
 * Phase 1 (this file): there is no remote gateway HTTP client yet.
 * Populate `UsageRecord` via `POST /api/webhooks/usage-ingest` (HMAC),
 * `POST /api/webhooks/litellm` (LiteLLM generic_api Bearer), or a future
 * vendor pull job; set `INTEGRATION_GATEWAY=real` so F1/F2/F3 read the
 * live mirror instead of throwing `NotImplementedError`.
 *
 * Phase 2: when a vendor (LiteLLM / Portkey / Helicone / …) is chosen,
 * extend this module with pull/subscribe logic while keeping the same
 * `GatewayClient` surface.
 */

export { postgresMirrorGatewayClient as realGatewayClient } from "./postgres-mirror";
