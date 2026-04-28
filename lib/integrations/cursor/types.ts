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

export type CursorWaitlistEntry = {
  email: string;
  displayName: string;
  reason: "LOANER_USAGE" | "NEW_JOINER" | "STEERING_EXCEPTION";
  position: number;
};

export type CursorClient = {
  listSeats(): Promise<CursorSeat[]>;
  listWaitlist(): Promise<CursorWaitlistEntry[]>;
};
