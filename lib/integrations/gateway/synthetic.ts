/**
 * Synthetic GatewayClient — reads mirrored `UsageRecord` rows from the
 * dev DB (deterministic seed). Same implementation as the "real" mirror
 * client; only the `INTEGRATION_GATEWAY` env flag differs at the factory.
 */

export { postgresMirrorGatewayClient as syntheticGatewayClient } from "./postgres-mirror";
