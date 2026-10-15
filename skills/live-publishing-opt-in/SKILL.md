---
name: live-publishing-opt-in
description: >-
  Use when the operator wants Grok Bot to publish products or change live products, prices or stock. Off by default; requires MEDUSA_ALLOW_PUBLISH=true plus confirm=true per call, one product at a time, with read-back.
---
# live-publishing-opt-in

**Step 0 (Golden Rule, [golden-rule-read-docs-first](../golden-rule-read-docs-first/SKILL.md)):** before any command, answer, or write below, call `medusa_docs` for the topic. If the docs do not cover it, say **"not in official docs"** and mark the step UNVERIFIED. Endpoints marked *(verified)* were checked against the official Medusa v2 API reference on 2026-10-15; re-check after Medusa upgrades.

## Gate
- **Default: draft-only.** Without `MEDUSA_ALLOW_PUBLISH=true`, these refuse `confirm=true`: `product_publish`, `live_product_update`, price changes on non-draft products (`variant_price_update`), and all `inventory_level_update` (stock is always live). Dry-runs still work.
- **Opt-in** is an operator setting in the plugin config, never something the bot sets itself. Even with the opt-in, every write needs `confirm=true` on that call.

## Cautions (follow every time)
1. **Test one SKU first.** Publish or change one product, check it, then continue. There is no bulk-publish tool on purpose.
2. **Dry-run first** and read `blockers` and `warnings`. `product_publish` blocks on: no sales channel, variants without prices, or all inventory-managed variants at zero stock.
3. **No mass-publishing zero-stock items.** `allow_zero_stock=true` only for a deliberate pre-order, approved by a human.
4. **Sales-channel check:** the product must be linked to the channel the storefront's publishable key uses. After publishing, confirm with `store_products` (shopper view).
5. **Read back after every write.** `product_publish` verifies `status=published` itself. For price and stock, re-read with `list_variants` / `inventory_levels`.
6. Changing `handle` changes the storefront URL. Status changes only go through `product_publish`.
7. To roll back, set the product back to draft in Medusa Admin. This plugin doesn't unpublish or delete.
