/**
 * CursorClient — abstraction over Cursor's admin API for seat state and
 * waitlist. v1.1 adds writes (seat grant / reclaim) via this interface +
 * a policy-repo PR (see scoping §4 integration #4, §4.6.1).
 */

export type CursorSubTier = "POWER" | "STANDARD" | "LIGHT";

export type CursorSeat = {
  userId: string;
  email: string;
  displayName: string;
  subTier: CursorSubTier;
  lastActivityTs: Date | null;
  /** Days since last allowed Cursor usage; null if never used. */
  idleDays: number | null;
  /** Month-to-date Cursor spend in USD. */
  mtdSpendUsd: number;
};

export type CursorWaitlistReason =
  | "LOANER_USAGE"
  | "NEW_JOINER"
  | "STEERING_EXCEPTION";

export type CursorWaitlistEntry = {
  email: string;
  displayName: string;
  /** Free-form role tag from Deel (used in F4 row display). */
  roleTag: string;
  reason: CursorWaitlistReason;
  /** Tier the user is waitlisted for. */
  requestedTier: CursorSubTier;
  /** Human-readable rationale (manager attestation excerpt etc.). */
  rationale: string;
  position: number;
};

export type CursorClient = {
  listSeats(): Promise<CursorSeat[]>;
  listWaitlist(): Promise<CursorWaitlistEntry[]>;
};
