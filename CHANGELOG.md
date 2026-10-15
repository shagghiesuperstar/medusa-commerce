# Changelog

## 1.1.0 (2026-10-15)
- Opt-in live writes: `product_publish` and `live_product_update`. Price changes on live products and all stock changes now need `MEDUSA_ALLOW_PUBLISH=true` plus `confirm=true`. Pre-publish blockers: sales channel, prices, zero stock.
- `scripts/setup-mcloud.sh` and the `medusa-cloud-cli` skill: official mcloud CLI, persistent under $HOME/.local, with self-restore.
- Network errors (reset/TLS/DNS) now carry an egress hint (found in the live read-only test).
- Category `e-commerce`; companion Medusa Store Ops template section.
- 52 smoke checks.

## 1.0.0 (2026-10-15)
- Initial release: 16-tool zero-dependency MCP server (read-only by default, draft-only writes, dry-run unless confirm=true), 6 skills, bundled mock, smoke, skills and privacy tests.
