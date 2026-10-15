---
name: medusa-cloud-environments
description: >-
  Use when deleting or cleaning up Medusa Cloud environments, previews, storefronts or projects, or when finding an environment's current backend/admin URL and domains.
---
# medusa-cloud-environments

**Step 0 (Golden Rule, [golden-rule-read-docs-first](../golden-rule-read-docs-first/SKILL.md)):** before any command, answer, or write below, call `medusa_docs` for the topic. If the docs do not cover it, say **"not in official docs"** and mark the step UNVERIFIED. Items marked *(verified)* were checked against docs.medusajs.com on 2026-10-15; items marked *(per Medusa Cloud Assistant, not verified in docs)* came from a Medusa Cloud Assistant chat and must be re-checked before use. Re-check everything after Medusa upgrades.

This skill is **guidance only**. The plugin has no Cloud delete tools; every delete below is done by a human in the Cloud dashboard. Never delete on the user's behalf.

## Deleting things
| Goal | How | Source |
|---|---|---|
| Delete a long-lived environment (e.g. Staging) | Environment dashboard > **Deployment Rules** > **Delete Environment** section > Delete. Deletes its DB and env vars, irreversible. | *(verified)* https://docs.medusajs.com/cloud/environments/long-lived#delete-an-environment |
| Delete Production | **Not possible.** Production can't be deleted; promote another environment or delete the whole project. | *(verified)* same page |
| Delete a preview environment | Auto-deleted when its PR is merged or closed; manual delete uses the same steps as long-lived. | *(verified)* https://docs.medusajs.com/cloud/environments/preview#delete-preview-environment |
| Delete only the storefront | Project Settings > **Delete Storefront**. Removes the storefront deployment; the backend and its databases stay. | *(verified)* https://docs.medusajs.com/cloud/projects#delete-storefront |
| Remove a whole project (e.g. created in the wrong region) | Project Settings > General > **Delete project**, type `delete project` to confirm. Deletes all environments and deployments (backend + DBs). Irreversible. | *(verified)* https://docs.medusajs.com/cloud/projects#delete-project |

Before any project delete: take a DB dump and export env vars. A project's region can't be changed in place *(per Medusa Cloud Assistant, not verified in docs)*, so a wrong-region project is recreated, not moved.

## Domains and URLs
- Each environment gets a backend subdomain under `medusajs.app` and a storefront subdomain under `medusajs.site`; you can change them from the environment's **Domains** settings *(verified: https://docs.medusajs.com/cloud/environments/subdomains)*.
- Custom domains: environment **Settings > Domains** *(verified: https://docs.medusajs.com/cloud/environments/custom-domains)*. Promoting to Production does not carry over the custom domain *(verified: long-lived page)*.
- Each environment has a random generated default subdomain (adjective-noun-verb style) plus an optional project custom subdomain, and both resolve *(per Medusa Cloud Assistant, not verified in docs)*.
- Admin lives at `https://<backend-domain>/app` *(per Medusa Cloud Assistant, not verified in docs; matches the default admin path)*.
- `mcloud environments list -p <project> --json` shows each environment's `default_domain` *(per Medusa Cloud Assistant, not verified in docs; see [medusa-cloud-cli](../medusa-cloud-cli/SKILL.md))*.

## Lesson (ours)
- After a project is deleted, its old backend hostnames stop resolving. **Always read the current backend URL from `mcloud environments list -p <project> --json`**, never from a stale `.env` or notes. A DNS/NXDOMAIN error on a known-good config usually means the URL is stale, not that the store is down. *(our field lesson; UNVERIFIED in docs)*
