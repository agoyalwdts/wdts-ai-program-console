# Production deploy — `wdts-ai-program-console`

Source of truth for the production deploy story. Driven by
[`docs/decisions/0003-deploy-target.md`](../decisions/0003-deploy-target.md).

> **Nothing in this folder auto-runs.** Both the bootstrap script and
> the sample GitHub Actions workflow are draft / sample artefacts.
> Promoting them to live deploy actions is a deliberate manual step
> documented in the runbook.

## Files

| File | What it is | Run by |
|---|---|---|
| `azure.md` | Full runbook. Walks through every choice and the order to make them in. Read this first. | The human reviewer (`AGENTS.md` §10 N4) |
| `azure-bootstrap.sh` | Sample one-shot Azure provisioning script. Parameterised on subscription / RG / region / app name. **One-time**, run by hand on a workstation that's `az login`-ed against the **WDTS** corp subscription. | A human, reading every line first |
| `deploy.yml.sample` | Sample GitHub Actions workflow. Promoted to active by **copying** to `.github/workflows/deploy.yml` once the prod resource group, the service principal, the federated credential, and the `production` GitHub environment all exist. | GitHub Actions, after promotion |

## Pre-conditions before any of this runs

The `AGENTS.md` §13 open-blockers list is the canonical version of this;
the runbook references it.

- **N1** — WDTS Azure subscription + RG name pinned (not the personal
  Azure sub the increment apps live on).
- A **fresh** Microsoft Entra ID app registration for production
  (separate from the dev/sandbox one in `.env.local`), with the
  `groups` claim configured.
- Region picked: **`centralindia`** or **`eastus`** (per LDR 0003).
- Human reviewer / approver named for the GitHub `production`
  environment.
- Branch protection on `main` — `main` is the only ref the deploy
  workflow trusts.

## How the runbook fits with the existing dev story

| Stage | What runs | What's used |
|---|---|---|
| Local dev | `npm run dev` + local Postgres + `.env.local` | Sandbox Entra ID app, plain `.env.local` secrets |
| CI (every PR + every push to `main`) | `.github/workflows/ci.yml` (typecheck + lint + 115 tests) | No external services |
| Production deploy (this folder) | `.github/workflows/deploy.yml` (after promotion) | Prod Entra ID app, Key Vault secrets, prod Postgres |

Each tier has its own credential set. They never share a secret store.
