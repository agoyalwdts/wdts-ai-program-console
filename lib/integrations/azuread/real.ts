/**
 * Real AzureADClient — calls Microsoft Graph (the same surface used by
 * M365GraphClient, but scoped to identity). NOT YET IMPLEMENTED — blocked
 * on §8 N1 (Azure subscription) + N2 (domain) + app registration scopes.
 */

import { NotImplementedError } from "../errors";
import type { AzureADClient } from "./types";

export const realAzureADClient: AzureADClient = {
  async listUsers() {
    throw new NotImplementedError("azuread", "listUsers");
  },
  async getUserByEmail() {
    throw new NotImplementedError("azuread", "getUserByEmail");
  },
  async getManager() {
    throw new NotImplementedError("azuread", "getManager");
  },
};
