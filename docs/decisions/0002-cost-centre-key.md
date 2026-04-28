# 0002 — Canonical cost-centre key on `User`

**Status:** proposed
**Date:** 2026-04-28
**Authors:** Cursor agent (drafting)
**Decider:** Anuj + WDTS FinOps — needs sign-off before any FinOps view depends on it

## Context

Scoping §2 F10 ("Overage / chargeback view") describes a "cross-product
per-team monthly bill … supports the FinOps showback model." The
implementation in `app/(dashboard)/chargeback/page.tsx` currently groups
spend by **manager hierarchy** (`User.managerId`) because that's the only
team-shaped field on `User` today.

That's the right cut for a manager-attestation flow but the **wrong** cut
for FinOps showback. FinOps wants to allocate spend to **cost centres** —
finance-owned codes that don't move when an org-chart edge does. Two
distinct concepts:

- **Manager hierarchy** — how reports roll up. Changes whenever someone
  switches teams. Already on `User`. Drives F2 user list, F3 manager queue,
  F8 exception attestation, F10's _team_ view.
- **Cost centre** — the GL code finance bills against. Stable across
  org-chart shuffles. _Not_ on `User` today. Drives F10's
  _showback_ view, the v1.1 chargeback report, and the budget-allocation
  logic in Appendix H of the executive policy.

Today F10's "team" header is the manager's name. After this ADR it would
either be the cost-centre code (showback view) or the manager's name
(operational view) — selectable.

## Decision

Add a single new column to `User`:

```prisma
costCentre String?  // canonical key: see §"Canonical key" below
```

**Canonical key shape:** `"<businessUnit>-<glCode>"`, e.g. `"ENG-4501"`,
`"COMPLIANCE-7102"`. ASCII-only, uppercase BU prefix, dash separator,
no whitespace. Capped at 32 chars to keep indexes lean. Unknown / not-yet-
mapped → `null` (not the empty string).

**Source of truth:** Deel — extend `DeelEmployee` to carry `costCentre`
and let the nightly reconciler write it onto `User`. If Deel does not
expose it, FinOps maintains a one-column override CSV that the reconciler
applies _after_ Deel.

**Allowed-value list:** finance-maintained, lives in
`lib/finops/cost-centres.ts` as a typed array. Validation on write
rejects values not in the list (drift-protection — a typo in Deel must
not silently create a new cost centre).

## Rationale

- **Single canonical column beats a parallel system.** A separate
  `CostCentre` table joined via `userId` is technically purer but adds
  a join to every F10 / chargeback query and a second source of truth
  to keep aligned with Deel. Until showback adds a separate workflow
  (org-chart-of-cost-centres, owner per cost centre, etc.) a flat
  column wins.
- **String, not enum.** New cost centres are added every quarter
  somewhere in WDTS. An enum would force a Prisma migration each time;
  a typed allowlist in code is cheaper to update and version-controllable.
- **`null` is a real state.** New hires often land in Deel before
  finance has assigned a cost centre. F10 surfaces them under
  "unassigned" rather than guessing.
- **Capped at 32 chars / ASCII** because it'll go into URL query
  strings, CSV exports (`/api/decisions/export`), and CSV chargeback
  reports — all of which behave better when the key is ASCII-safe.
- **Deel-first ingest** keeps the dashboard a thin workflow layer
  (per AGENTS.md §3 "strategic posture") — finance edits flow through
  Deel + the override CSV, not through the dashboard's UI.

## Alternatives considered

| Alternative | Why it lost |
|---|---|
| Separate `CostCentre` model + `User.costCentreId` FK | Adds a join to every chargeback query; second source of truth to reconcile with Deel. Worth doing _later_ when cost centres need their own metadata (owner email, parent cost centre, budget envelope). |
| Use `User.region` as proxy | Region tracks _jurisdiction_ (scoping §3.3), not finance accountability. Already used by the DLP / data-residency code paths; conflating it with chargeback would couple two separate concerns. |
| Use `User.roleTag` as proxy | Role tag is a job-family classifier (`sw_engineer_senior`) — orthogonal to which cost centre pays for that engineer. |
| Use `manager.email` rooted at the org chart | Same problem the manager hierarchy has: it moves when people switch teams. |
| Adopt the Microsoft Graph `companyName` / `department` fields | These are AAD-driven, set by IT, not by finance. Track 2 (Graph integration) would expose them — _useful_, but not the FinOps source of truth. |
| Numeric-only key (`"4501"`) | Loses the BU prefix that lets F10 group BUs without a separate table. Cheap to add; expensive to remove later. |

## Consequences

**Code:**

- `prisma/schema.prisma` — add `costCentre String?` to `User`.
  Index on `(costCentre)` for the chargeback group-by.
- `lib/integrations/deel/types.ts` — add `costCentre: string | null` to
  `DeelEmployee`. Synthetic Deel fixture mints deterministic codes
  (e.g. round-robin from a 6-element list); real Deel client extracts
  whichever Deel custom-field WDTS uses (TBD).
- `prisma/seed.ts` — assign cost centres deterministically in the seed.
- `app/(dashboard)/chargeback/page.tsx` — add a `?groupBy=cost-centre`
  query-string toggle alongside the existing manager grouping. Default
  stays manager-grouping for v0.3; flip default to cost-centre once
  finance has signed off on the allowed-value list.
- `lib/finops/cost-centres.ts` (new) — typed allowlist + validator
  (`isCostCentre(s)`).
- `app/api/decisions/export/route.ts` — add `costCentre` column to the
  CSV when present (purely additive; existing consumers ignore unknown
  columns).

**Process:**

- The `costCentre` allowlist in code is owned by FinOps. PRs that change
  it require a FinOps signoff (CODEOWNERS entry, once we have one).
- Override-CSV path: `data/finops-overrides.csv`. Out of git. Loaded by
  the reconciler. Empty until FinOps publishes one.

**Failure modes:**

- Deel writes a value not in the allowlist → reconciler logs + leaves
  `costCentre` unchanged + emits a `Decision` row of type
  `METHODOLOGY_CHANGE` for visibility.
- FinOps drops a code from the allowlist → users with that code get
  `null` on next reconcile. F10 surfaces them as "unassigned".

## Open follow-ups

- **Allowed-value list itself** — needs FinOps to publish the list of
  WDTS cost centres before this ADR can flip from `proposed` →
  `accepted`. This is the actual blocking decision.
- **Where Deel stores cost centre** — custom field name, format. Needs
  a 5-minute conversation with whoever owns Deel admin.
- **Override-CSV workflow** — does FinOps want a UI to edit it, or is
  the file-on-disk plus a quarterly review enough? Defer to ADR 0006.
- **Sub-cost-centre / project codes.** Some chargeback regimes split a
  cost centre across projects. Not in scope here; surfaces as a
  follow-up `User.projectCode` if/when it does.
