# 0004 — Cursor is credit-bound, not seat-bound: 4 sub-tiers, 120-seat allocation plan inside a $500K/yr envelope

**Status:** accepted
**Date:** 2026-04-28
**Authors:** Cursor agent (drafting)
**Decider:** Anuj — flagged the drift in chat 2026-04-28, signed off in the
same thread.

## Context

`lib/program.ts`, the F4 cursor-seats page, the synthetic seed, and several
docstrings were authored against the **v1.x** snapshot of
`Executive_Policy_and_Guardrails.md`. That snapshot modelled Cursor as:

- **84 paid seats** out of a 120-seat trial (i.e. 36 seats reduced via
  Appendix G's "rationalisation" methodology, supported by §16.5
  rationalisation comms).
- **Three sub-tiers** — Power (17), Standard (42), Light (25) — each with a
  per-user monthly cap.
- The cap-sum (~$32K/mo) sat well below the $500K/yr envelope; the binding
  constraint at the program level was the *seat count*, not the dollar
  envelope.

The **v2.0** policy (live in `agoyalwdts/wdts-ai-policy` as of April 2026)
reverses both premises:

- **Vendor confirmed**: Cursor licenses are **uncapped within the credit
  envelope**. The binding constraint is the **$500K/yr** dollar envelope,
  *not* a seat count. This is the single sentence that retires the v1.x
  design — there is no scarcity at the seat level any more, only at the
  credit level.
- **120-seat allocation plan**, not an 84-seat cut. All 120 trial users
  move onto a paid sub-tier; nobody is displaced.
- **Four sub-tiers** — Power (17, $900/mo), Standard (42, $400/mo), Light
  (25, $300/mo), and a new **Cursor Discovery (36, $50/mo)** floor that
  parallels Codex Discovery. The cap-sum (~$41,400/mo, ~$496,800/yr) is
  engineered to fit *inside* the $500K envelope, with ~$3,200/yr held
  centrally for short-term elevations.
- Appendix G is now a **tier-assignment** methodology, not a seat-cut
  methodology. The political failure mode of "a manager has to tell three
  of their engineers they're losing Cursor" disappears entirely.

The dashboard had to be re-pinned to the v2.0 shape, and a record had to
exist of *why* the constants changed and what happens to v1.x assumptions
that may still be lurking in scoping references.

## Decision

The dashboard treats Cursor as **credit-bound at the program level and
allocation-planned at the user level**:

- **Source of truth for sub-tier counts and caps** — §4.6.1 of
  `Executive_Policy_and_Guardrails.md` in `agoyalwdts/wdts-ai-policy`,
  reflected literally in `lib/program.ts` (`CURSOR_TIERS`,
  `CURSOR_SEATS`).
- **Sub-tiers** — `POWER` ($900/mo, 17 users), `STANDARD` ($400/mo, 42),
  `LIGHT` ($300/mo, 25), `DISCOVERY` ($50/mo, 36). `CURSOR_TOTAL_SEATS`
  derives to **120**.
- **Binding constraint surfaced on F4** — the **$500K/yr credit envelope**.
  The 120-seat shape is presented as WDTS's allocation plan inside the
  envelope, not as a vendor cap. The `CardDescription` on the seat-board
  card calls out "credit-capped, not seat-capped" explicitly so a reader
  doesn't read the 120 number as a hard ceiling.
- **`CursorSubTier` integration type** — `"POWER" | "STANDARD" | "LIGHT" |
  "DISCOVERY"`. Every Cursor-touching client (synthetic + real) and every
  store of seat assignments (`License.subTier` `"cursor_*"` strings,
  policy-repo TOML on the v0.3 path) accepts the four-tier shape.
- **Dormancy / reclamation semantics** — Power / Standard / Light keep the
  v1.x 30-day-notice / 45-day-reclaim rule; Discovery follows a
  longer **90-day dormancy** rule parallel to Codex Discovery's 120-day
  rule (§4.6.4). The dashboard does not yet enforce different idle-day
  thresholds per sub-tier; F4's amber/rose ring colours stay at the
  generic ≥14d / ≥30d thresholds for v0.2. v0.3 introduces per-tier
  `idleDays` thresholds when `ReclamationEvent` lands.

## Rationale

1. **Faithful to vendor reality.** The April 2026 vendor confirmation
   removes the entire premise of the seat-cut design. Modelling Cursor as
   seat-bound would re-introduce a constraint the vendor doesn't
   actually enforce.
2. **Faithful to program reality.** Every other tier-assignment surface
   in the policy (Codex Discovery, M365 review) reads "120 / four
   sub-tiers / inside a credit envelope". The dashboard reading
   "84 / three sub-tiers" was the only place this drift was visible.
3. **Discovery is a real tier, not a presentational artefact.** A user
   on Discovery has a $50/mo cap, can submit usage records, can be
   promoted to Light. F4 must therefore *render* it (so the seat-board
   tells the truth about who has Cursor at all) rather than fold
   Discovery users into "empty" cells.
4. **Constants-driven render.** The seat-board now iterates `TIER_ORDER`
   and `CURSOR_SEATS[tier]` instead of hard-coding three sub-tiers. The
   next sub-tier change (or seat-quota tweak) is a `lib/program.ts` edit
   plus a colour line, not a seat-board rewrite.

## Alternatives considered

- **Keep the 84/3 model and footnote the v2.0 update.** Rejected — the
  user was explicit that the policy is the source of truth, the dashboard
  needs to be in sync, and a footnote is exactly the failure mode that
  let the drift survive into the live preview.
- **Render only the cap-sum, drop the seat numbers.** Rejected — the
  120-seat allocation plan is the unit of conversation between
  Engineering Mgmt and FinOps in the §4.6.1 / §4.6.4 / Appendix G
  workflow. Hiding it would make F4 useless for the people it's for.
- **Show the $500K envelope as a `BudgetBar` (like ChatGPT+Codex on F1).**
  Deferred — the F4 seat-board's job is the seat-level view; F1's
  per-product Cursor card already renders the envelope as a `BudgetBar`
  against MTD spend. Adding a second budget bar to F4 would duplicate
  signal without adding new information.
- **Push the v2.0 numbers into the policy repo's `cursor.toml` and read
  them at runtime.** Right idea, wrong PR. Cursor sub-tier counts and
  caps are not in `codex-policies/policies/*.toml` today (Cursor is
  governed by the vendor admin API + Appendix G + §4.6.1 prose, not by
  the same TOML mechanism Codex uses). v0.3 introduces the
  `lib/integrations/policyrepo` Cursor write path; until then, the
  numbers live in `lib/program.ts` and this LDR pins them.

## Consequences

Bound by this LDR until a successor record supersedes it:

- `lib/program.ts::CURSOR_TIERS`, `CURSOR_SEATS`, `CURSOR_TOTAL_SEATS`,
  and the module-level docstring.
- `lib/integrations/cursor/types.ts::CursorSubTier`.
- `lib/integrations/cursor/synthetic.ts::asSubTier` and the waitlist
  generator's `requestedTier` distribution.
- `app/(dashboard)/cursor-seats/page.tsx` — the four-tier render, the
  legend, the `TIER_COLOURS` / `WAITLIST_BADGE` maps, and the
  "credit-capped, not seat-capped" framing on the seat-board card.
- `app/(dashboard)/settings/page.tsx` — the "Cursor commitment" probe
  row.
- `prisma/seed.ts` — the four-cohort split (Power / Standard / Light /
  Discovery) and the per-cohort spend intensity.
- `AGENTS.md` and `README.md` — the F4 description.

When v2.1 ships (or the vendor commercial model changes again), bump
`CURSOR_*` in `lib/program.ts`, rebase this LDR, and supersede if the
shape changes structurally (not just the numbers).

## Open follow-ups

- **Per-tier dormancy thresholds.** F4 currently uses ≥14d / ≥30d
  amber/rose rings uniformly. v0.3 should split: Power/Standard/Light
  remain on 30/45-day notice/reclaim; Discovery moves to 90-day. Track
  alongside `ReclamationEvent` in LDR 0001.
- **Cursor admin API → `License.subTier` reconciliation.** The real
  Cursor SCIM client (`lib/integrations/cursor/real.ts`) currently
  defaults every active SCIM user to `"STANDARD"` because the SCIM v2
  schema doesn't carry a sub-tier field. The v0.4 plan (per the
  `TODO(v0.4)` in `real.ts`) is to join the policy-repo state to derive
  sub-tier per user. That join needs to learn about Discovery too.
- **F1 per-product Cursor card.** The `MONTHLY_BUDGET_USD.CURSOR`
  rendering ($41,667/mo) is unchanged; the comment on the constant now
  explicitly names this as the credit envelope, not a seat-derived
  number. No render change required, but a future v0.3 enhancement could
  surface the cap-sum-vs-envelope gap (~$200/mo headroom) as a small
  side-note on the card.
- **Codex F1 card label.** `MONTHLY_BUDGET_USD.CODEX` is the residual
  share of the $150K combined ChatGPT+Codex envelope, not the v2.3
  Codex cap-sum (~$209K/mo, intentionally over-committed). The misleading
  "sub-tier sum" comment was fixed in this PR; the *render label*
  ("of $134,300 monthly budget") is still accurate as "envelope share".
  Revisiting whether F1 should show the cap-sum-vs-envelope overcommit
  story directly is left to v0.3.
