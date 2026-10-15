---
name: getting-started
description: >-
  Use on first install or when the Medusa connection looks wrong. Configure MEDUSA_BACKEND_URL, a secret admin API key and optional publishable key, then run store_health and a read-only tour.
---
# getting-started

**Step 0 (Golden Rule, [golden-rule-read-docs-first](../golden-rule-read-docs-first/SKILL.md)):** before any command, answer, or write below, call `medusa_docs` for the topic. If the docs do not cover it, say **"not in official docs"** and mark the step UNVERIFIED. Endpoints marked *(verified)* were checked against the official Medusa v2 API reference on 2026-10-15; re-check after Medusa upgrades.

## Configure
| Variable | Required | What |
| --- | --- | --- |
| `MEDUSA_BACKEND_URL` | yes | Backend URL in server mode, e.g. `http://localhost:9000` |
| `MEDUSA_ADMIN_API_KEY` | yes | **Secret** API key (Medusa Admin > Settings > Secret API Keys). Sent as `Authorization: Basic <token>` *(verified: Admin API > Authentication)* |
| `MEDUSA_PUBLISHABLE_KEY` | optional | Publishable key, sent as `x-publishable-api-key` on `/store` routes *(verified: Store API)* |

Keep keys in the host's secret store or env. Never paste them into chat, files, or memory.

## First run
1. `store_health` → expect `OK`. `WARN` usually means no publishable key or a key whose sales channel exposes 0 products. `FAIL` → fix before anything else.
2. `list_sales_channels`, `list_categories`, `list_tags` to learn the catalog shape.
3. `list_products {status:"draft"}` and `store_products` to compare what exists with what shoppers see.
4. Writes stay dry-run until you pass `confirm=true`. Products are only ever created or edited as **draft**.

## Gotchas
- A 401 on `/admin` usually means the wrong key type (publishable instead of secret), a revoked key, or a v1-style header.
- A 400 on `/store` complaining about the publishable key means the header is missing.
- `/health` returning OK only proves the server is up, not that your key works. That's why `store_health` checks auth too.
