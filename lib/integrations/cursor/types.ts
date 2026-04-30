/**
 * CursorClient — abstraction over Cursor's admin API for seat state and
 * waitlist. v1.1 adds writes (seat grant / reclaim) via this interface +
 * a policy-repo PR (see scoping §4 integration #4, §4.6.1).
 *
 * Sub-tiers track Executive_Policy_and_Guardrails.md §4.6.1 (four-sub-tier
 * shape introduced in v2.0, carried unchanged through v2.3). DISCOVERY is
 * the $50/mo floor of the Discovery → Light → Standard → Power promotion
 * ladder, added when the v2.0 revision retired the v1.x "84 seats / 36
 * cuts" model in favour of the 120-seat credit-bound shape ($500K/yr
 * envelope, no vendor seat cap).
 */

export type CursorSubTier = "POWER" | "STANDARD" | "LIGHT" | "DISCOVERY";

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
  /** Free-form role tag from Deel (used in F4 row display). Nullable —
   *  Deel emits null for ex-employees / pre-onboarding hires. */
  roleTag: string | null;
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
