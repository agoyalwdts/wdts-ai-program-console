/**
 * DeelClient — abstraction over Deel's HRIS REST API + webhooks for the
 * `roleTag` and manager-id of every employee. Webhook-driven (real-time);
 * the full list is fetched nightly for reconciliation.
 *
 * Refs: Dashboard_Scoping_v1.md §4 integration #3; §6 Q7; §8 N6.
 */

export type DeelEmployee = {
  email: string;
  displayName: string;
  /** Free-form role tag, e.g. 'sw_engineer_senior', 'tech_writer', 'compliance'. */
  roleTag: string;
  managerEmail: string | null;
  region: string;
  status: "ACTIVE" | "SUSPENDED" | "TERMINATED";
};

export type DeelWebhookEvent = {
  type: "EMPLOYEE_UPDATED" | "EMPLOYEE_TERMINATED" | "EMPLOYEE_HIRED";
  email: string;
  payload: DeelEmployee;
  receivedAt: Date;
};

export type DeelClient = {
  listEmployees(): Promise<DeelEmployee[]>;
  getEmployeeByEmail(email: string): Promise<DeelEmployee | null>;
};
