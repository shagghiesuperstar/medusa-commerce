# Medusa Commerce

A Grok Bot plugin that lets Grok Bot **manage a [Medusa](https://docs.medusajs.com) v2 store as an agent**: self-hosted or on Medusa Cloud, one store at a time. You get fail-loud health, a read-only view of catalog, inventory and orders, a draft-only product pipeline, and **opt-in** publishing and live edits. Created by [@pixelrainbownft](https://x.com/pixelrainbownft).

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
- **Medusa (Cloud) MCP**: `https://cloud.medusajs.com/mcp`. **Read-only** access to Admin and Store API data for stores deployed on Medusa Cloud (v2.12.4+). Tools: `list_connected_environments`, `find_commerce_api`, `describe_commerce_api`, `read_admin_api`, `read_store_api`, `list_medusa_publishable_keys`, `ask_medusa_question`, `submit_medusa_feedback`. The `mcloud` name is Medusa Cloud's official **CLI**, not an MCP. `scripts/setup-mcloud.sh` installs it (see [Medusa Cloud CLI](#medusa-cloud-cli-mcloud)).

This plugin complements them. It works with **any** Medusa v2 backend (including self-hosted ones) through a secret API key, and it adds the one thing the Cloud MCP doesn't do: **gated writes** (draft products, prices, stock), always dry-run first. Connect the official servers too if you have a Cloud account; see `mcp.remote.example.json`.

## Principles
1. **Golden Rule: official docs first.** Every skill starts with the docs, and every lesson cites a doc or is marked UNVERIFIED.
2. **Bitter-lesson engineering.** 23 thin tools, zero dependencies, and judgment left to the model and the skills. There's no rules engine. A tool exists only where raw access would be unsafe or awkward.
3. **Compound engineering.** Every fix becomes a skill rule plus a `LESSON` regression test, logged in [docs/LESSONS.md](docs/LESSONS.md). The loop lives in `skills/compound-learnings`.
4. **Safe by default.** Reads are the default. Writes are dry-run unless `confirm=true`. By default, products are **only created or edited as drafts**. Publishing, live edits, live prices and stock need the operator opt-in `MEDUSA_ALLOW_PUBLISH=true` **and** `confirm=true` on each call. Orders come back PII-minimal unless you explicitly opt in.
5. **Fail loud.** Missing config, a bad key, an unreachable backend, or a draft that reads back with the wrong status all produce `FAIL` or `ERROR`, never a silent pass. Keys are redacted from every output.

## What's inside
| Component | Path |
|---|---|
| MCP server (zero-dependency Node ≥ 18; stdio or HTTP) | `server/index.mjs` |
| MCP config (stdio) / remote + official MCP example | `mcp.json`, `mcp.remote.example.json` |
| Skills (13), known-issues reference | `skills/`, `references/` |
| mcloud CLI installer (persistent, self-restoring) | `scripts/setup-mcloud.sh` |
| Multi-store observability dashboard (HTML + JSON, localhost/tailnet serve) | `scripts/dashboard.mjs` |
| Manifests | `.cursor-plugin/plugin.json`, `plugin.json` |
| Lessons, changelog | `docs/LESSONS.md`, `CHANGELOG.md` |
| Tests (mock Medusa + docs, smoke, skills lint, privacy scan) | `test/` |

### Tools
| Tool | Kind | Endpoint (official v2) |
|---|---|---|
| `store_health` | read | `GET /health`, `GET /admin/products?limit=1`, `GET /store/products?limit=1` |
| `observability_dashboard` | read | live health/admin/store + `GET /admin/api-keys?type=publishable`, plus in-memory latency/error recorder; optional HTML |
| `events_poll_since` | read | cursor poll of in-process plugin events (optional webhook) |
| `audit_log` | read | query append-only JSONL audit trail |
| `remediation_status` | read (hooks off by default) | list/run allowlisted remediation hooks |
| `rate_limit_status` | read | per-surface rolling counts + rate-limit headers |
| `list_products`, `get_product` | read | `GET /admin/products`, `GET /admin/products/{id}` |
| `list_variants` | read | `GET /admin/products/{id}/variants` |
| `inventory_levels` | read | `GET /admin/inventory-items` (`*location_levels`) |
| `list_orders`, `get_order` | read (PII-minimal) | `GET /admin/orders`, `GET /admin/orders/{id}` |
| `list_categories`, `list_tags`, `list_sales_channels` | read | `GET /admin/product-categories`, `/admin/product-tags`, `/admin/sales-channels` |
| `store_products` | read (shopper view) | `GET /store/products` + `x-publishable-api-key` |
| `draft_product_create` | write, dry-run, **draft only** | `POST /admin/products` (`status: "draft"`), then read-back |
| `draft_product_update` | write, dry-run, drafts only | `POST /admin/products/{id}` |
| `product_publish` | **opt-in** write, dry-run, one product | `POST /admin/products/{id}` (`status: "published"`), pre-checks + read-back |
| `live_product_update` | **opt-in** write, dry-run | `POST /admin/products/{id}` (no status changes) |
| `variant_price_update` | write, dry-run (opt-in if the product is live) | `POST /admin/products/{id}/variants/{variant_id}` (keeps the full price list) |
| `inventory_level_update` | **opt-in** write, dry-run | `POST /admin/inventory-items/{id}/location-levels/{location_id}` |
| `medusa_docs` | docs | docs.medusajs.com index and pages |

### Skills
`getting-started` · `golden-rule-read-docs-first` · `draft-product-pipeline` · `catalog-hygiene` · `inventory-sync-tips` · `live-publishing-opt-in` · `medusa-cloud-cli` · `medusa-cloud-environments` · `medusa-erp-inventory-sync` · `medusa-admin-orphan-links` · `medusa-cart-taxes` · `medusa-multi-entity-architecture` · `medusa-event-forwarding` · `compound-learnings`

Reference: [`references/known-issues.md`](references/known-issues.md) (GitHub issues to know about, existence verified).

## Safety model
- **Read-only by default.** Every write returns `dry_run: true` with the exact request (and the current values) until it's called with `confirm=true`.
- **Draft-only by default.** `draft_product_create` forces `status: "draft"` and fails loud if the read-back differs. `draft_product_update` refuses non-draft products and any status change.
- **Opt-in publishing** (`MEDUSA_ALLOW_PUBLISH=true`, an operator setting, plus `confirm=true` on each call) unlocks `product_publish`, `live_product_update`, price changes on live products, and stock changes. Without the opt-in, these refuse to execute; dry-runs still work.
- **No destructive tools.** There are no deletes, cancellations, refunds, unpublishing, or customer edits.
- **Least data.** Orders come back without email or addresses unless `include_customer=true`.
- **Secrets.** Keys live only in env or the plugin's secret config. They're sent as `Authorization: Basic <secret>` (admin) and `x-publishable-api-key` (store), and redacted from all output and errors.
- **Use a dedicated secret API key** for the bot, so you can revoke it on its own.

### Publishing cautions (read before setting MEDUSA_ALLOW_PUBLISH=true)
1. **Test one SKU first.** Publish or change one product, verify it, then continue. There is no bulk-publish tool.
2. **Read back after every write.** `product_publish` verifies `status=published` itself. Re-read prices with `list_variants` and stock with `inventory_levels`.
3. **No mass-publishing of zero-stock items.** `product_publish` blocks when every inventory-managed variant has zero stock. `allow_zero_stock=true` is only for deliberate pre-orders.
4. **Sales-channel check.** Publishing is blocked when the product has no sales channel. Afterwards, confirm with `store_products` that shoppers can see it.
5. Roll back by setting the product to draft in Medusa Admin.

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

## Medusa Cloud CLI (mcloud)
`mcloud` is Medusa Cloud's official CLI for organizations, projects, environments, builds, logs and variables ([docs](https://docs.medusajs.com/cloud/cli)). It needs Node.js v22+.
```
bash scripts/setup-mcloud.sh      # installs under $HOME/.local (persists), adds a private official Node 22 if needed
mcloud --version                  # verify
bash $HOME/.local/share/mcloud/setup-mcloud.sh   # self-restore after a box reset
mcloud login                      # YOU do this (browser), or set MCLOUD_TOKEN for CI. The bot never logs in.
```
The two official remote MCPs, the Docs MCP (`https://docs.medusajs.com/mcp`) and the read-only Cloud MCP (`https://cloud.medusajs.com/mcp`), are optional connectors you add with OAuth. See `mcp.remote.example.json` and `skills/medusa-cloud-cli`.


## Observability dashboard
Read-only live checks plus an in-memory latency/error recorder (ring buffer, last ~200 HTTP calls). Keys and auth headers are never recorded.

**MCP tool:** ask Grok Bot to run `observability_dashboard`. It returns JSON (surfaces up/down, latest/avg/p95 ms, publishable key table, recent errors with exact messages) and a markdown summary. Pass `format: "html"` to include a self-contained dark-theme HTML document, or `write_html: "/path/to/file.html"` to write it to disk.

**Multi-store dashboard (v1.5.0):** `scripts/dashboard.mjs` serves one page with a tab per store and the same sections per tab: surfaces (health, admin, store, docs) with status, HTTP code, live/latest/avg/p95 ms, sample count and error; publishable keys (redacted, revoked, sales channels, `NO SALES CHANNEL` WARN); recent errors; event feed (`events_poll_since`); credentials by env var **name** only; plus a global audit section (`audit_log`, read-only).
```
node scripts/dashboard.mjs --config /path/outside/repo/stores.json --state-dir /path/state           # one cycle, writes HTML
node scripts/dashboard.mjs --config stores.json --state-dir DIR --serve --host 127.0.0.1 --port 8790
node scripts/dashboard.mjs --config stores.json --serve --host tailscale   # Tailscale IPv4 only; 0.0.0.0 is refused
```
- **Config** (`scripts/stores.example.json`): keep the real file outside the repo. It lists env var names, never values. `enabled` defaults to **false**; a disabled store (or one whose host is in `blocked_hosts`) is never contacted, not even `/health`, and its tab shows *disabled by store-access rule*. A store with no keys present shows *no key configured* and only the unauthenticated `/health` runs.
- **JSON:** `GET /api/status.json` and `GET /api/stores/<id>.json` (no secrets; configured key values are scrubbed from every response). Only GET is accepted.
- **History:** bounded JSONL ring per store at `<state-dir>/history/<id>.jsonl` (`history_max`, min 500, default 1000). avg/p95/uptime come from this file, so they survive restarts.
- **Polite polling:** each store has its own MCP child with only that store's keys; one request at a time per store; base interval `refresh_sec` (min 10, default 60), doubling on any error/4xx/5xx/timeout up to `max_backoff_sec`.
- Without `--config` it falls back to a single store from `MEDUSA_BACKEND_URL` / `MEDUSA_ADMIN_API_KEY` / `MEDUSA_PUBLISHABLE_KEY`.

## Event stream, audit, remediation, rate limits
All additive and safe by default.

**Events.** `events_poll_since { cursor }` returns new in-process events (errors, health transitions, key warnings, audit, remediation). Optional outbound webhook: `MEDUSA_EVENTS_WEBHOOK_URL` with `MEDUSA_EVENTS_WEBHOOK_SECRET` (HMAC-SHA256 header `X-Medusa-Plugin-Signature`), retry with backoff, fail loud. The multi-store dashboard shows each store's event feed in its tab and in `/api/stores/<id>.json`. **Real Medusa store events** (`order.placed`, `inventory-level.updated`) need a backend subscriber — see skill `medusa-event-forwarding`; say **"not in official docs"** when the docs index has no match.

**Audit.** Every write and remediation attempt (including dry-runs) appends one JSONL row to `MEDUSA_AUDIT_LOG` (default `~/.medusa-plugin/audit.jsonl`) with redacted args and before/after snapshots. Query with `audit_log`.

**Remediation.** OFF unless `MEDUSA_ENABLE_REMEDIATION=true`. Still dry-run unless `MEDUSA_REMEDIATION_APPLY=true`. Allowlist: `MEDUSA_REMEDIATION_ALLOWLIST` (default `publishable_key_missing_sales_channel`). Built-in hook attaches the store's sole sales channel to orphan publishable keys only when exactly one channel exists (`POST /admin/api-keys/{id}/sales-channels`). `remediation_status` lists hooks; `run: true` evaluates them. Do not enable apply against production without a human review.

**Rate limits.** The HTTP helper tracks per-surface counts in a 1-minute window (`MEDUSA_RATE_BUDGET_PER_MIN`, default 60), parses `Retry-After` / `X-RateLimit-*`, backs off on 429/503 with jitter, and adds a `throttle` hint to tool responses when near the budget. Inspect with `rate_limit_status`.


## Hosting on a tailnet (Grok Bot pattern)
`scripts/dashboard.mjs --serve` defaults to **127.0.0.1**. It never binds `0.0.0.0`.

```
node scripts/dashboard.mjs --serve --port 8790 --refresh 30
node scripts/dashboard.mjs --serve --host tailscale --port 8790
# --host tailscale runs `tailscale ip -4` and refuses to start if Tailscale is down
# --host 100.x.y.z   # explicit Tailscale IPv4 only; replace with your node address
```

Open `http://<tailscale-ipv4>:8790/` or `http://<magicdns-hostname>:8790/` from another tailnet device (use your node's Tailscale IPv4 and MagicDNS hostname; do not commit real addresses). Keep secrets in process env only; do not write key values into launcher files. Pair with a small `ensure.sh` outside the repo if you want hourly self-restore.

## Install
1. Install **Medusa Commerce** from the Grok Bot marketplace (or point a connector at a local checkout).
2. Set `MEDUSA_BACKEND_URL` and `MEDUSA_ADMIN_API_KEY` (a secret key from Medusa Admin > Settings > Secret API Keys). Optionally set `MEDUSA_PUBLISHABLE_KEY`, and `MEDUSA_ALLOW_PUBLISH=true` only if you want the bot to publish and edit live data.
3. Ask: "run store_health". Expect `OK`.

Optional env: `MEDUSA_TIMEOUT_MS` (default 15000), `MEDUSA_DOCS_BASE`, `MEDUSA_DOCS_INDEX`.

## Develop / test
```
node test/smoke.mjs          # starts the bundled mock on 127.0.0.1:19000 (+ docs :19050); end-to-end checks (incl. opt-in publish gates + observability)
node test/skills.test.mjs    # step-0 Golden Rule in every skill; every lesson cites docs.medusajs.com or UNVERIFIED
node test/privacy-scan.mjs   # no IPs, emails, live keys, store domains, tokens (optional PRIVACY_DENYLIST file)
```

## Companion Grok Bot template: Medusa Store Ops (coming soon)
A docs-first commerce operator that uses this plugin to manage a Medusa v2 store as an agent. **Template link:** coming soon (not published yet). The bot hasn't been created. By [@pixelrainbownft](https://x.com/pixelrainbownft) · [pixelrainbow.ai](https://pixelrainbow.ai).

### Startup (first run, one question at a time)
1. Is the Medusa Commerce plugin installed? If not, it links the install.
2. What's the backend URL? Staging is recommended first.
3. Add `MEDUSA_ADMIN_API_KEY` (a dedicated secret key) and optionally `MEDUSA_PUBLISHABLE_KEY` as plugin secrets. They're never pasted in chat.
4. Draft-only, or opt-in publishing? `MEDUSA_ALLOW_PUBLISH` stays off unless you say so.
5. Optional: install `mcloud` with `scripts/setup-mcloud.sh` (you run `mcloud login` yourself), and connect the official Docs and Cloud MCPs.
6. Where to send alerts, and when you want the daily report.

Then it runs `store_health` and a read-only tour (sales channels, categories, drafts vs storefront) and summarizes what it found.

### Behavior
- **Golden Rule:** it calls `medusa_docs` before unfamiliar actions and says "not in official docs" when a topic isn't covered.
- **Daily:** `store_health`, a catalog-hygiene audit, stock exceptions, and drafts waiting for review. One short all-clear when everything is green; it fails loud otherwise.
- **On request:** photos → draft products. Price and stock changes and publishing are dry-run first, one SKU first, read back after the write, never zero-stock mass-publishing, and they need the opt-in.
- **Never:** deletes, refunds, cancellations, or customer edits, and it doesn't put customer data in chat by default.
- **Compound learnings:** every surprise becomes a skill rule plus a test.

## Credit
Built from real Medusa v2 operating lessons, generalized, by [@pixelrainbownft](https://x.com/pixelrainbownft). MIT licensed. Not affiliated with Medusa.

## More from pixelrainbow
Visit https://pixelrainbow.ai for more Grok Bot skills, plugins and templates.
