# Medusa Commerce

A Grok Bot plugin for running a [Medusa](https://docs.medusajs.com) **v2** store: self-hosted or on Medusa Cloud, one store at a time. You get fail-loud health, a read-only view of catalog, inventory and orders, and a draft-only product pipeline. Created by [@pixelrainbownft](https://x.com/pixelrainbownft).

## Golden Rule: read the official Medusa docs first
**Before any Medusa action, answer, or write, the agent reads the official Medusa docs for that topic. It does not guess from memory, which is often Medusa v1.**

- Sources: the [Admin API](https://docs.medusajs.com/api/admin) and [Store API](https://docs.medusajs.com/api/store) references, plus the agent index at https://docs.medusajs.com/llms.txt.
- Tool: `medusa_docs` searches the official index or greps an official page. It refuses other origins.
- Skill: `golden-rule-read-docs-first` is **step 0 of every skill** (a test enforces this).
- Every endpoint the server calls was checked against the official v2 OpenAPI reference, and each tool result carries its `doc` link.
- Gaps get the label **"not in official docs"** and are marked **UNVERIFIED** (see [docs/LESSONS.md](docs/LESSONS.md)).

### Official Medusa MCP servers (verified 2026-10-15)
Medusa hosts two official remote MCP servers. Both use Streamable HTTP and OAuth with a Medusa Cloud account:
- **Docs MCP**: `https://docs.medusajs.com/mcp`. Answers questions from the docs (`ask_medusa_question`) and provides implementation guides. It also accepts a Cloud personal access key as a Bearer token.
- **Medusa (Cloud) MCP**: `https://cloud.medusajs.com/mcp`. **Read-only** access to Admin and Store API data for stores deployed on Medusa Cloud (v2.12.4+). Tools: `list_connected_environments`, `find_commerce_api`, `describe_commerce_api`, `read_admin_api`, `read_store_api`, `list_medusa_publishable_keys`, `ask_medusa_question`, `submit_medusa_feedback`. The `mcloud` name is Medusa Cloud's **CLI** (for example `mcloud environments trigger-build`), not a separate MCP.

This plugin complements them. It works with **any** Medusa v2 backend (including self-hosted ones) through a secret API key, and it adds the one thing the Cloud MCP doesn't do: **gated writes** (draft products, prices, stock), always dry-run first. Connect the official servers too if you have a Cloud account; see `mcp.remote.example.json`.

## Principles
1. **Golden Rule: official docs first.** Every skill starts with the docs, and every lesson cites a doc or is marked UNVERIFIED.
2. **Bitter-lesson engineering.** 16 thin tools, zero dependencies, and judgment left to the model and the skills. There's no rules engine. A tool exists only where raw access would be unsafe or awkward.
3. **Compound engineering.** Every fix becomes a skill rule plus a `LESSON` regression test, logged in [docs/LESSONS.md](docs/LESSONS.md). The loop lives in `skills/compound-learnings`.
4. **Safe by default.** Reads are the default. Writes are dry-run unless `confirm=true`. Products are **only ever created or edited as drafts**, and the server refuses to publish. Orders come back PII-minimal unless you explicitly opt in.
5. **Fail loud.** Missing config, a bad key, an unreachable backend, or a draft that reads back with the wrong status all produce `FAIL` or `ERROR`, never a silent pass. Keys are redacted from every output.

## What's inside
| Component | Path |
|---|---|
| MCP server (zero-dependency Node ≥ 18; stdio or HTTP) | `server/index.mjs` |
| MCP config (stdio) / remote + official MCP example | `mcp.json`, `mcp.remote.example.json` |
| Skills (6) | `skills/` |
| Manifests | `.cursor-plugin/plugin.json`, `plugin.json` |
| Lessons, changelog | `docs/LESSONS.md`, `CHANGELOG.md` |
| Tests (mock Medusa + docs, smoke, skills lint, privacy scan) | `test/` |

### Tools
| Tool | Kind | Endpoint (official v2) |
|---|---|---|
| `store_health` | read | `GET /health`, `GET /admin/products?limit=1`, `GET /store/products?limit=1` |
| `list_products`, `get_product` | read | `GET /admin/products`, `GET /admin/products/{id}` |
| `list_variants` | read | `GET /admin/products/{id}/variants` |
| `inventory_levels` | read | `GET /admin/inventory-items` (`*location_levels`) |
| `list_orders`, `get_order` | read (PII-minimal) | `GET /admin/orders`, `GET /admin/orders/{id}` |
| `list_categories`, `list_tags`, `list_sales_channels` | read | `GET /admin/product-categories`, `/admin/product-tags`, `/admin/sales-channels` |
| `store_products` | read (shopper view) | `GET /store/products` + `x-publishable-api-key` |
| `draft_product_create` | write, dry-run, **draft only** | `POST /admin/products` (`status: "draft"`), then read-back |
| `draft_product_update` | write, dry-run, drafts only | `POST /admin/products/{id}` |
| `variant_price_update` | write, dry-run | `POST /admin/products/{id}/variants/{variant_id}` (keeps the full price list) |
| `inventory_level_update` | write, dry-run | `POST /admin/inventory-items/{id}/location-levels/{location_id}` |
| `medusa_docs` | docs | docs.medusajs.com index and pages |

### Skills
`getting-started` · `golden-rule-read-docs-first` · `draft-product-pipeline` · `catalog-hygiene` · `inventory-sync-tips` · `compound-learnings`

## Safety model
- **Read-only by default.** Only 4 tools write, and each returns `dry_run: true` with the exact request (and the current values) until it's called with `confirm=true`.
- **Never auto-publish.** `draft_product_create` forces `status: "draft"` and fails loud if the read-back status differs. `draft_product_update` refuses non-draft products and any status change. Publishing is a human step in Medusa Admin.
- **No destructive tools.** There are no deletes, cancellations, refunds, or customer edits.
- **Least data.** Orders come back without email or addresses unless `include_customer=true`.
- **Secrets.** Keys live only in env or the plugin's secret config. They're sent as `Authorization: Basic <secret>` (admin) and `x-publishable-api-key` (store), and redacted from all output and errors.
- **Use a dedicated secret API key** for the bot, so you can revoke it on its own.

## Recommended architecture
```
 Grok Bot ──(stdio/HTTP MCP)──> medusa-commerce plugin ──HTTPS──> Medusa v2 backend (/admin, /store)
     │                                                                ▲
     ├──(optional, OAuth)──> Medusa Docs MCP  (docs.medusajs.com/mcp) │
     └──(optional, OAuth)──> Medusa Cloud MCP (cloud.medusajs.com/mcp, read-only)
 Image pipeline: photos → (optional background/template step) → hosted URLs → draft_product_create → human publishes in Admin
 Inventory sync: external system (source of truth for qty) → inventory_level_update (dry-run, then confirm) → log
```
- Run the backend with a **staging environment** first. Point the plugin at staging, prove the flow with one SKU, then switch to production.
- Give the bot its **own secret API key**, and store it in your secrets manager, not in chat or repo files.
- Decide **one source of truth per field** (for example external system → quantity, Medusa → price) before you automate syncs.
- Run the real `medusa build` (type-checked) in CI before deploys. Fast test transpilers can hide type errors that only show up at build time.
- Remote mode: `MCP_TRANSPORT=http MCP_PORT=8788 MCP_AUTH_TOKEN=... node server/index.mjs`. It binds `127.0.0.1` by default, so put it behind a private network and never expose it publicly.

## Install
1. Install **Medusa Commerce** from the Grok Bot marketplace (or point a connector at a local checkout).
2. Set `MEDUSA_BACKEND_URL` and `MEDUSA_ADMIN_API_KEY` (a secret key from Medusa Admin > Settings > Secret API Keys). Optionally set `MEDUSA_PUBLISHABLE_KEY`.
3. Ask: "run store_health". Expect `OK`.

Optional env: `MEDUSA_TIMEOUT_MS` (default 15000), `MEDUSA_DOCS_BASE`, `MEDUSA_DOCS_INDEX`.

## Develop / test
```
node test/smoke.mjs          # starts the bundled mock on 127.0.0.1:19000 (+ docs :19050); 38 end-to-end checks
node test/skills.test.mjs    # step-0 Golden Rule in every skill; every lesson cites docs.medusajs.com or UNVERIFIED
node test/privacy-scan.mjs   # no IPs, emails, live keys, store domains, tokens (optional PRIVACY_DENYLIST file)
```

## Companion Grok Bot template: Medusa Store Ops
A docs-first commerce desk that pairs with this plugin. It runs a daily `store_health` and catalog-hygiene report, a draft-product intake from photos, and dry-run-first stock and price changes.

**Template link:** coming soon (not published yet). By [@pixelrainbownft](https://x.com/pixelrainbownft) · [pixelrainbow.ai](https://pixelrainbow.ai).

- **First run:** confirms the plugin is installed, asks for the backend URL, and has you add the keys as plugin secrets (never in chat). Then it runs `store_health` and the read-only tour.
- **Daily:** `store_health` → catalog-hygiene audit → stock exceptions. Short all-clear when everything is green; it fails loud otherwise.
- **On request:** draft products from images. Never publishes.

## Credit
Built from real Medusa v2 operating lessons, generalized, by [@pixelrainbownft](https://x.com/pixelrainbownft). MIT licensed. Not affiliated with Medusa.

## More from pixelrainbow
Visit https://pixelrainbow.ai for more Grok Bot skills, plugins and templates.
