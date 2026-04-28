/**
 * Real DeelClient — calls the Deel REST API + handles webhook events.
 * NOT YET IMPLEMENTED — blocked on §8 N6 (API token + webhook URL).
 * Refs: scoping §4 integration #3.
 */

import { NotImplementedError } from "../errors";
import type { DeelClient } from "./types";

export const realDeelClient: DeelClient = {
  async listEmployees() {
    throw new NotImplementedError("deel", "listEmployees");
  },
  async getEmployeeByEmail() {
    throw new NotImplementedError("deel", "getEmployeeByEmail");
  },
};
