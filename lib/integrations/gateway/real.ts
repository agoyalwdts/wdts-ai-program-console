/**
 * Real GatewayClient — wired to the production AI gateway audit log.
 *
 * NOT YET IMPLEMENTED. The gateway vendor is selected in Phase 0 of the
 * program (Portkey / LiteLLM / Helicone). Once selected, replace the
 * stubs below with the vendor SDK calls and add an integration test that
 * exercises this implementation against a staging tenant.
 *
 * Refs: Dashboard_Scoping_v1.md §4 (integration #2), §6 Q5.
 */

import { NotImplementedError } from "../errors";
import type { GatewayClient } from "./types";

export const realGatewayClient: GatewayClient = {
  async listUsageRecords() {
    throw new NotImplementedError("gateway", "listUsageRecords");
  },
  async aggregateByUser() {
    throw new NotImplementedError("gateway", "aggregateByUser");
  },
  async aggregateByProgram() {
    throw new NotImplementedError("gateway", "aggregateByProgram");
  },
  async managerQueue() {
    throw new NotImplementedError("gateway", "managerQueue");
  },
};
