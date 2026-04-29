# LDR 0005 — App-level RBAC: dashboard owns its own access control

## Status
accepted (2026-04-29)

## Context

After the v0.2 preview deploy went live, three things became visible at once:

1. **Identity vs authorization conflation.** The auth wiring (PR #17) read
   the IdP's `groups` claim and used AAD security-group OIDs to resolve
   the dashboard role. That meant adding a FinOps user required filing a
   ticket with IT to add them to a security group. For an internal
   AI-taskforce tool with one or two new users a quarter, that's the
   wrong default.
2. **The owner is not the IT admin.** The dashboard owner (CTO / head of
   AI Task Force) needs to manage roles autonomously, without an
   intermediary. AAD security groups are owned by IT, not by program
   leadership.
3. **The original "thin workflow layer" framing was over-applied.** The
   dashboard *does* own some authoritative state — the `Decision` log
   is the obvious one. Roles + access policy belong on the same list:
   they're an operational decision the program makes, not a fact that
   exists somewhere upstream.

The question that surfaced: should role assignments live in AAD
(security groups, env-mapped to dashboard roles) or in the dashboard's
own database?

## Decision

**Dashboard role + permissions live in Postgres, owned by the dashboard
admin UI.** Microsoft Entra ID provides identity (sign-in, MFA, JML
events). Authorization is a `User → Role → permissions[]` graph stored
locally and managed via `/settings/users` and `/settings/roles`.

A small bootstrap email rule remains so a fresh-DB / new-tenant deploy
can sign in and configure the rest. After first sign-in, all role
changes go through the admin UI.

## Rationale

- **One screen, no tickets.** The owner needs to add a user, change a
  role, or disable an account in seconds. AAD-group RBAC adds a
  human-in-the-loop on every change.
- **Custom roles are cheap.** Storing `permissions: string[]` on `Role`
  lets the owner define new roles ("auditor" with read-only spend
  surfaces; "cursor lead" with seat-board write later in v0.4) without
  asking IT for a new group.
- **Identity vs auth is now cleanly separated.** AAD does what it's
  good at (federated sign-in, conditional access, JML offboarding) and
  the dashboard does what it's good at (knowing what each role is
  allowed to do *inside* the dashboard).
- **Future-compatible.** Nothing in the v0.4 / v0.5 backlog *requires*
  AAD-group resolution. If the program later grows to a point where
  IT-owned access is preferable, layering an AAD-group resolver on top
  of the existing `Role` table is mechanical (see Open follow-ups).

## Alternatives considered

| # | Approach | Rejected because |
|---|---|---|
| 1 | **AAD security groups → role mapping (env-var configured)**, kept from PR #17. | Adds an IT-ticket on every membership change. Not appropriate for an internal taskforce tool. The owner explicitly rejected this path. |
| 2 | **No RBAC; everyone signed in is admin.** | Fine for the current 1-user reality, but a foot-gun the moment a second person logs in. The friction of rebuilding RBAC mid-flight (with live decision-log audit trails) is far higher than building it once now. |
| 3 | **Hybrid: built-in roles via AAD groups, custom roles via DB.** | Two sources of truth → debugging "why did X get role Y?" needs both AAD and DB inspection. The trace panel becomes a multi-line screen. Reject. |
| 4 | **External RBAC service (OpenFGA, Cerbos, Permify).** | Useful at fleet scale; massive overkill for a 1-app dashboard. Reconsider only if a second internal app starts sharing the same access model. |

## Consequences

### Schema
- `Role` table: `id`, `key (unique)`, `displayName`, `description`,
  `isBuiltIn`, `permissions: string[]`, `createdAt`, `updatedAt`.
- `User` gains `dashboardRoleId` (nullable FK), `disabled` (bool),
  `isOwner` (bool, exactly one row), `title` (free-text, e.g. "CTO ·
  Head of AI Task Force").
- Built-in role rows (`USER` / `MANAGER` / `FINOPS` / `ADMIN`) are
  upserted on every seed; their permission lists are owned in code at
  `lib/rbac/built-in-roles.ts`. Custom roles live entirely in the DB.

### Auth wiring (`auth.ts`)
- `jwt` callback: on `signIn` trigger, JIT-`upsert` the `User` row.
  Bootstrap email rule runs only when no `User` exists for that email.
  Subsequent sign-ins read role + permissions straight from
  `User.dashboardRole`.
- `disabled=true` users get an empty permission array, so privileged
  routes redirect them to `/?error=disabled` instead of bricking the
  whole sign-in.

### Authorization helpers (`lib/auth.ts`)
- `requireRole(["ADMIN"])` retained for back-compat.
- `requirePermission("users.manage")` is the new preferred call. New
  routes use this; legacy routes can migrate at leisure.

### Audit trail
- Every role change, user enable/disable, custom-role create/edit/delete
  writes a row to the existing `Decision` table with new types
  `ROLE_CHANGE`, `USER_DISABLED`, `USER_ENABLED`, `ROLE_CREATED`,
  `ROLE_EDITED`, `ROLE_DELETED`.

### Owner protection
- `User.isOwner=true` cannot be demoted, disabled, or have its role
  changed by any actor (including the owner themselves via the API —
  ownership transfer is a separate, explicit action that's not in
  v0.3's scope).

### Trade-offs accepted
- **AAD group claims are no longer surfaced.** The "Your session" trace
  panel drops the `groups` list. If the org later wants to AAD-gate the
  dashboard at all, that goes through Conditional Access on the prod
  app registration, not in our code.
- **Bootstrap email rule remains.** It's two lines of regex that exist
  exactly so a fresh-DB deploy doesn't lock everyone out. Documented as
  the only place the IdP claims drive role assignment.
- **The "thin workflow layer" rule in `AGENTS.md` needed amending.** The
  dashboard now owns one more authoritative entity (`Role` and the
  `User → Role` link). Updated in the same PR.

## Open follow-ups

- **Future scope: AAD-group based RBAC.** If the program grows to the
  point where dashboard access needs to be IT-owned (e.g. integrated
  with WDTS's broader IAM posture, audited by a security team
  separate from the AI Task Force), the path is:
  1. Add an `aadGroupId: string?` column to `Role` for an optional
     binding.
  2. In the JWT callback, after the DB lookup, walk the `groups`
     claim and find the *highest-precedence* role bound to one of
     those OIDs.
  3. UI: add a "Bound AAD group" picker on `/settings/roles/[id]`
     for ADMIN.
  Tracked here so it's not forgotten; do **not** start until the
  trigger fires.
- **Ownership transfer flow.** Out of scope for v0.3. A v0.4 admin
  action lets the current owner pick a new owner from existing
  ADMINs; both rows transition atomically.
- **Group reconciler from Graph.** Useful for CSV-import-equivalent
  for new joiners (auto-create a `User` row when a Graph user appears
  in a configured group). Out of scope; tracked under `m365graph`
  reconciler items.
- **Service accounts & API tokens.** Custom roles solve the human
  case; M2M is a separate v0.5 design (HMAC-signed tokens, no JWT
  flow).
- **Permission-key drift on built-in roles.** Adding a permission to
  the catalogue auto-grants it to ADMIN on next seed (programmatic);
  the other built-ins must be edited deliberately. Documented in
  `lib/rbac/permissions.ts`.
- **Two-pass `User.isOwner` uniqueness.** Currently enforced at the
  application layer. If we ever want a hard guarantee, add a partial
  unique index `CREATE UNIQUE INDEX ON "User" ("isOwner") WHERE
  "isOwner" = true;` via a follow-up migration.
