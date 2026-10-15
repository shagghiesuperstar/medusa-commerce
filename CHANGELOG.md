# Changelog

## 1.4.0 (2026-10-15)
- **Event stream:** in-process bus for plugin-captured errors, health transitions, key warnings, audit and remediation; MCP tool `events_poll_since` (cursor); optional `MEDUSA_EVENTS_WEBHOOK_URL` with HMAC-SHA256 (`X-Medusa-Plugin-Signature`) and retry/backoff; `/events` SSE on MCP HTTP transport and on `scripts/dashboard.mjs --serve`.
- **Audit trail:** append-only JSONL (`~/.medusa-plugin/audit.jsonl` or `MEDUSA_AUDIT_LOG`) for every write/remediation including dry-runs; tool `audit_log`.
- **Remediation hooks** (OFF by default): `MEDUSA_ENABLE_REMEDIATION` + optional `MEDUSA_REMEDIATION_APPLY`; allowlist via `MEDUSA_REMEDIATION_ALLOWLIST`; built-in `publishable_key_missing_sales_channel` (POST `/admin/api-keys/{id}/sales-channels` when exactly one channel exists); tool `remediation_status`.
- **Rate-limit awareness:** rolling per-surface counts, `Retry-After` / `X-RateLimit-*`, backoff on 429/503 with jitter, budget `MEDUSA_RATE_BUDGET_PER_MIN` (default 60), `throttle` hint on tool responses; tool `rate_limit_status`.
- Skill `medusa-event-forwarding` (docs-first): real Medusa store events need a backend subscriber; gaps marked not in official docs.
- Smoke coverage for events, audit dry-run, remediation off/dry-run, throttle hint. No live remediation against real stores.


## 1.3.0 (2026-10-15)
- Read-only **observability dashboard**: in-memory error/latency ring buffer (last ~200 calls) on the HTTP helper; surfaces `health` / `admin` / `store` / `docs`; never records keys or headers.
- New MCP tool `observability_dashboard`: live `/health`, admin auth, store check, publishable API key table (title, redacted token, revoked, sales channels; `NO SALES CHANNEL` WARN), latency latest/avg/p95, recent errors with exact messages; markdown summary; optional `format: "html"` or `write_html` for a self-contained dark-theme HTML file.
- `scripts/dashboard.mjs` writes `medusa-dashboard.html` (or `--out`) and optional `--serve` on `127.0.0.1:8790` (refresh every 30s). Localhost bind only; read-only GETs.
- Mock: `GET /admin/api-keys`; smoke coverage for healthy surfaces, orphan key WARN, verbatim store error capture, no secrets in output.


## 1.2.0 (2026-10-15)
- Five knowledge skills from a Medusa Cloud Assistant session, each claim checked against docs.medusajs.com and tagged *(verified)* or *(per Medusa Cloud Assistant, not verified in docs)*: `medusa-cloud-environments`, `medusa-erp-inventory-sync`, `medusa-admin-orphan-links`, `medusa-cart-taxes`, `medusa-multi-entity-architecture`.
- `references/known-issues.md`: 8 Medusa GitHub issues (existence verified).
- Guidance only: no new tools, no SQL execution, no Cloud deletes.
- Privacy scan also flags real-looking Medusa resource IDs (`sloc_`, `sc_`, `scloc_`, `prod_`, `order_`, `cart_`...).

## 1.1.0 (2026-10-15)
- Opt-in live writes: `product_publish` and `live_product_update`. Price changes on live products and all stock changes now need `MEDUSA_ALLOW_PUBLISH=true` plus `confirm=true`. Pre-publish blockers: sales channel, prices, zero stock.
- `scripts/setup-mcloud.sh` and the `medusa-cloud-cli` skill: official mcloud CLI, persistent under $HOME/.local, with self-restore.
- Network errors (reset/TLS/DNS) now carry an egress hint (found in the live read-only test).
- Category `e-commerce`; companion Medusa Store Ops template section.
- 52 smoke checks.

## 1.0.0 (2026-10-15)
- Initial release: 16-tool zero-dependency MCP server (read-only by default, draft-only writes, dry-run unless confirm=true), 6 skills, bundled mock, smoke, skills and privacy tests.
