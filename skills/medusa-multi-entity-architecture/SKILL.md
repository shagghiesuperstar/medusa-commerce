---
name: medusa-multi-entity-architecture
description: >-
  Use when planning Medusa for several legal entities or brands, or B2C plus B2B, on Medusa Cloud: instance boundaries, B2B pricing, branches/environments and deploy freezes.
---
# medusa-multi-entity-architecture

**Step 0 (Golden Rule, [golden-rule-read-docs-first](../golden-rule-read-docs-first/SKILL.md)):** before any command, answer, or write below, call `medusa_docs` for the topic. If the docs do not cover it, say **"not in official docs"** and mark the step UNVERIFIED. Items marked *(verified)* were checked against docs.medusajs.com on 2026-10-15; items marked *(per Medusa Cloud Assistant, not verified in docs)* came from a Medusa Cloud Assistant chat and must be re-checked before use. Re-check everything after Medusa upgrades.

Most of this is architecture advice from a Medusa Cloud Assistant chat; treat it as **per Medusa Cloud Assistant, not verified in docs** unless marked.

## Entities
- **Separate legal entities → separate backend instances and databases**, sharing one codebase. The Store module is not entity isolation; payment providers scope by region; sales channels scope catalog/stock, not data or accounting. *(per Medusa Cloud Assistant)*
- One brand with B2C + B2B can stay in one instance: B2B via **customer groups + price lists**, plus the quote-management guide or the B2B starter *(per Medusa Cloud Assistant; check docs.medusajs.com recipes/b2b before building)*.

## Medusa Cloud layout
- One Cloud **project per backend**; environments map to branches (long-lived like Production/Staging, previews per PR) *(environments verified: https://docs.medusajs.com/cloud/environments/long-lived)*.
- No path-filtered builds and no deploy freeze per project *(per Medusa Cloud Assistant)*. To freeze one entity while another ships, point each project at its **own branch** and merge into it deliberately.
- Run migrations in the predeploy step: `medusa db:migrate` *(per Medusa Cloud Assistant; confirm in Cloud build docs)*.
- Prefer feature flags for per-entity behaviour in shared code; use branches for release timing, not for divergent code.

## Known issues that bite B2B / multi-location
See [references/known-issues.md](../../references/known-issues.md): #16822, #15737 (group pricing), #16502, #16825, #16995, #16338, #16012.
