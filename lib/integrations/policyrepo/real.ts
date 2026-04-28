/**
 * Real PolicyRepoClient — opens PRs against `codex-policies/` via the
 * GitHub API. NOT YET IMPLEMENTED — v1.1 deliverable.
 *
 * Critical implementation notes for whoever wires this up:
 *  - Every PR must reference a Decision row id in the body.
 *  - The dashboard's service principal must never merge its own PRs;
 *    branch protection requires a human reviewer.
 *  - SCIM updates flow downstream from the merged PR, not from the
 *    dashboard. The dashboard never writes to a vendor API directly.
 */

import { NotImplementedError } from "../errors";
import type { PolicyRepoClient } from "./types";

export const realPolicyRepoClient: PolicyRepoClient = {
  async openPullRequest() {
    throw new NotImplementedError("policyrepo", "openPullRequest");
  },
  async getPullRequest() {
    throw new NotImplementedError("policyrepo", "getPullRequest");
  },
};
