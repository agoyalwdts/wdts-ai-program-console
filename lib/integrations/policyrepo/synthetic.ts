/**
 * Synthetic PolicyRepoClient — pretends to open a PR by returning a
 * deterministic example URL. Useful for v1.1 UI development before the
 * real GitHub-API integration lands. Does NOT mutate any real repo.
 */

import type { PolicyChange, PolicyPullRequest, PolicyRepoClient } from "./types";

let nextNumber = 9000;

export const syntheticPolicyRepoClient: PolicyRepoClient = {
  async openPullRequest(change: PolicyChange): Promise<PolicyPullRequest> {
    const number = nextNumber++;
    void change.patch;
    void change.paths;
    return {
      number,
      url: `https://example.wdts.com/policies/pull/${number}`,
      branch: `dashboard/${change.decisionId}`,
      state: "OPEN",
    };
  },

  async getPullRequest(number: number): Promise<PolicyPullRequest | null> {
    return {
      number,
      url: `https://example.wdts.com/policies/pull/${number}`,
      branch: `dashboard/synthetic-${number}`,
      state: "OPEN",
    };
  },
};
