/**
 * AzureADClient — abstraction over Azure AD / Entra ID for identity sync.
 * Used by NextAuth (auth) and by the nightly identity reconciler that
 * mirrors Azure AD users into the local User table.
 *
 * Refs: Dashboard_Scoping_v1.md §4 integration #1; §6 Q2; §8 N2.
 */

export type IdentityUser = {
  email: string;
  displayName: string;
  /** Azure AD object id. */
  azureObjectId: string;
  /** Email of the user's manager (may be null at the top of the org). */
  managerEmail: string | null;
  status: "ACTIVE" | "SUSPENDED" | "TERMINATED";
};

export type AzureADClient = {
  listUsers(): Promise<IdentityUser[]>;
  getUserByEmail(email: string): Promise<IdentityUser | null>;
  getManager(email: string): Promise<IdentityUser | null>;
};
