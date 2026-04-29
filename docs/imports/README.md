# Data imports

CSV-based import paths for the dashboard. v0.2 ships **employees only**;
licence + usage imports are tracked under v0.3.

## Why

The Deel integration (HRIS → `prisma.user` reconciler) was originally
positioned as a Tier-0 unblock for going live. It isn't anymore: a CSV
upload covers the same need with zero vendor coupling, so we get a real
employee list into Prisma whenever you have a roster, regardless of
whether Deel is configured.

## Endpoints

| Endpoint                                | Auth          | Notes                            |
| --------------------------------------- | ------------- | -------------------------------- |
| `GET  /api/imports/employees/sample`    | session-bound | Sample CSV, 5 rows               |
| `POST /api/imports/employees?dryRun=1`  | ADMIN, FINOPS | Parse + validate, no writes      |
| `POST /api/imports/employees`           | ADMIN, FINOPS | Parse + validate + upsert + log  |

`POST` accepts either `multipart/form-data` with a `file` field, or a
`text/csv` body. Max 5 MB.

## CSV schema (employees)

Header row required. Column order doesn't matter. Unknown columns are
ignored (and surfaced in the response as a warning).

| Column         | Required | Notes                                                                |
| -------------- | -------- | -------------------------------------------------------------------- |
| `email`        | yes      | Unique within the file. Compared case-insensitively against the DB.  |
| `displayName`  | yes      | Free text                                                            |
| `roleTag`      | yes      | Free text. e.g. `ENG`, `PM`, `DS`, `FINOPS`, `EXEC`. Used by F2/F4   |
| `region`       | yes      | Free text. e.g. `APAC`, `NA`, `EMEA`. Used by F8                     |
| `managerEmail` | no       | Must resolve to another row in the file or an existing employee     |
| `status`       | no       | One of `ACTIVE`, `LEFT`, `ON_LEAVE`. Defaults to `ACTIVE`            |

A sample is checked in at `employees.sample.csv` next to this README,
and is also served by the dashboard at `/api/imports/employees/sample`.

## Behavioural rules

- **Upsert by email.** Existing rows are updated in-place; new rows are
  created.
- **Manager linkage is two-pass.** A manager listed below the report in
  the same file resolves correctly. Direct cycles (`managerEmail ==
  email`) are rejected; multi-hop cycles are not currently detected.
- **Re-imports never delete.** If an employee disappears from a later
  CSV, their row stays. Use `status=LEFT` to flag a departure. This is
  deliberate — the alternative ("operator imports the wrong file →
  whole org wiped") is too dangerous.
- **All-or-nothing on errors.** Any validation error → 422 response, no
  rows written. Operator fixes the file and re-uploads.
- **Audit row.** Every successful import writes a `Decision` row of
  type `EMPLOYEE_IMPORT` with the `actorEmail` and an after-state of
  `{added, updated, unchanged, total}`. Visible on F5 and on the
  dashboard's `/settings/imports` page (recent-five list).

## Excel

CSV-only on purpose. Excel parsing on the server adds a non-trivial
dependency for marginal benefit; export "Save As CSV (Comma delimited)"
covers the gap. Revisit if a real import lands a binary `.xlsx` and the
operator can't re-export.

## Quick test from the command line

```bash
# Replace TENANT-COOKIE with the value of next-auth.session-token from
# your browser; the route is session-gated.
curl -i -X POST \
  -H "Cookie: authjs.session-token=$TENANT_COOKIE" \
  -F "file=@docs/imports/employees.sample.csv" \
  https://wdts-ai-program-console.azurewebsites.net/api/imports/employees?dryRun=1
```

## Roadmap

- v0.2 (this PR) — employees, CSV-only, dry-run, no Deel coupling.
- v0.3 — license + usage imports (`/api/imports/licenses`,
  `/api/imports/usage`) for tenants that don't have OpenAI / Anthropic
  / Cursor admin keys yet.
- v1.x — Deel reconciler lands on top of this; CSV path stays as the
  fallback when the API is unreachable or for tenants without Deel.
