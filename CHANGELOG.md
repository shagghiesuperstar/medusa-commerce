# Changelog

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
