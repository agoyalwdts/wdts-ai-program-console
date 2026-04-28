/**
 * Synthetic PolicyRepoClient — pretends to open a PR by returning a
 * deterministic example URL. Useful for v0.3+ UI development before the
 * real GitHub-API integration is wired with a token. Does NOT mutate
 * any real repo.
 */

import type {
  PolicyChange,
  PolicyPullRequest,
  PolicyRepoClient,
} from "./types";

let nextNumber = 9000;

export const syntheticPolicyRepoClient: PolicyRepoClient = {
  async openPullRequest(change: PolicyChange): Promise<PolicyPullRequest> {
    const number = nextNumber++;
    void change.files;
    void change.body;
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
