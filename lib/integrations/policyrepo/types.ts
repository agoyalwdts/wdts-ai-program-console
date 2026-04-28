/**
 * PolicyRepoClient — write path. Every dashboard write (tier promotion /
 * demotion, reclamation, exception grant) opens a PR in the policy
 * repo (`agoyalwdts/wdts-ai-policy`, configurable via
 * `POLICYREPO_OWNER` / `POLICYREPO_NAME`) via the GitHub API. The
 * dashboard never writes directly to a vendor API.
 *
 * Refs: Dashboard_Scoping_v1.md §4 integration #8; §6 Q12; .cursor/rules/data-model.mdc.
 *
 * v0.3 lands the real implementation. The shape supports a multi-file
 * write applied as N successive commits on a fresh branch (one commit
 * per file via the GitHub Contents API), then a PR is opened pointing
 * at the new branch.
 */

export type PolicyFile = {
  /** Path relative to the policy repo's root, e.g. `tiers/codex.yaml`. */
  path: string;
  /** Full file contents (UTF-8). The real client base64-encodes for the
   *  GitHub Contents API; the synthetic client just records the bytes
   *  for later inspection. */
  content: string;
};

export type PolicyChange = {
  /** Free-form intent — surfaces in the PR title. */
  title: string;
  /** Files to write on the new branch. Each entry produces one commit
   *  with message `<title> [decision: <decisionId>] (<path>)`. Multi-file
   *  writes therefore appear as N commits in the PR — auditable, and
   *  cheaper than synthesising a tree object via the Git Data API. */
  files: PolicyFile[];
  /** Optional Markdown body for the PR description. The real client
   *  always appends a "Decision: <decisionId>" line so the link from
   *  PR ↔ dashboard ledger is mechanical. */
  body?: string;
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
