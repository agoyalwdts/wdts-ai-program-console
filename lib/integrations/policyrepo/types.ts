/**
 * PolicyRepoClient — write path. Every dashboard write (tier promotion /
 * demotion, reclamation, exception grant) opens a PR in the
 * `codex-policies/` repo via the GitHub API. The dashboard never writes
 * directly to a vendor API.
 *
 * Refs: Dashboard_Scoping_v1.md §4 integration #8; §6 Q12; .cursor/rules/data-model.mdc.
 *
 * v1.1 lands the real implementation. v0.1 only exposes the interface so
 * F6/F7/F8 can be coded against it once they start.
 */

export type PolicyChange = {
  /** Free-form intent — surfaces in the PR title. */
  title: string;
  /** Which policy file(s) to touch. */
  paths: string[];
  /** Patch content to apply (applied as a single commit on a fresh branch). */
  patch: string;
  /** Reference to the Decision row that authorises this change. */
  decisionId: string;
  /** Author email — the human (or service principal) on whose behalf the
   *  change is being opened. The dashboard's own service principal must
   *  never be the sole author of a substantive policy change. */
  authorEmail: string;
};

export type PolicyPullRequest = {
  number: number;
  url: string;
  branch: string;
  state: "OPEN" | "MERGED" | "CLOSED";
};

export type PolicyRepoClient = {
  /**
   * Open a pull request against the policy repo with the given change.
   * Implementations must record the resulting PR number/url back onto the
   * Decision row (via `evidenceLink`) before returning.
   */
  openPullRequest(change: PolicyChange): Promise<PolicyPullRequest>;
  /** Look up an existing PR by its number. */
  getPullRequest(number: number): Promise<PolicyPullRequest | null>;
};
